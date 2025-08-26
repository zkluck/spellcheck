/*
 * 角色流水线执行器：顺序执行给定的角色序列，支持多次运行与简单流式事件
 * 注意：每一次角色运行（包括多轮次与跨角色）都基于最初的入口文本进行修复，
 * 不会把上一轮或上一个角色的修复结果串联为下一次运行的输入。
 */
import { getRole } from './registry';
import { applyErrorItems } from '@/lib/text/patch';
import type { ErrorItem } from '@/types/error';
import type {
  AnalysisInput,
  ExecutorHooks,
  PipelineEntry,
  RoleContext,
  RoleFinal,
  RoleChunk,
  SSEEvent,
} from './types';

// 类型守卫：判断一个对象是否为 AsyncGenerator
function isAsyncGenerator<T = unknown>(obj: unknown): obj is AsyncGenerator<T> {
  if (typeof obj !== 'object' || obj === null) return false;
  const maybe = obj as { [Symbol.asyncIterator]?: unknown };
  return typeof maybe[Symbol.asyncIterator] === 'function';
}

// 自定义中止错误，统一名称以便上层识别（name = 'AbortError'）
class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

// 带中止信号感知的等待：在 signal 触发时立刻拒绝并抛出 AbortError
async function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) throw new AbortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (_ev: Event) => {
      cleanup();
      reject(new AbortError());
    };
    const cleanup = () => {
      try { signal.removeEventListener('abort', onAbort); } catch {}
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { cleanup(); resolve(v); },
      (err) => { cleanup(); reject(err); },
    );
  });
}

export async function* runPipeline(opts: {
  roles: PipelineEntry[];
  input: AnalysisInput;
  signal?: AbortSignal;
  hooks?: ExecutorHooks;
  metadata?: Record<string, unknown>;
}): AsyncGenerator<SSEEvent> {
  const { roles, input, signal, hooks, metadata } = opts;

  // 基础文本：每次运行都基于最初的入口文本，避免跨轮/跨角色串改
  const baseText: string = input.text;

  for (const entry of roles) {
    const { id, runs } = entry;
    const role = getRole(id);
    if (!role) {
      yield { roleId: id, stage: 'error', error: `role_not_found: ${id}` };
      hooks?.onError?.(id, new Error(`role_not_found: ${id}`));
      continue;
    }

    for (let i = 0; i < Math.max(1, runs || 1); i++) {
      if (signal?.aborted) throw new AbortError();
      hooks?.onStart?.(role.id);
      // 广播开始事件，携带本轮索引
      yield { roleId: role.id, stage: 'start', runIndex: i };

      const ctx: RoleContext = {
        signal,
        metadata: { ...(metadata || {}), runIndex: i, modelName: entry.modelName },
      };

      try {
        // 每次运行都使用最初的基础文本，避免把上一次修复结果作为下一次输入
        const out = role.run({ ...input, text: baseText }, ctx);
        if (isAsyncGenerator<RoleChunk>(out)) {
          // 流式适配：手动迭代以拿到最终返回值
          while (true) {
            if (signal?.aborted) throw new AbortError();
            const r = await abortable(out.next(), signal);
            if (r.done) {
              const final = r.value as RoleFinal;
              hooks?.onFinal?.(role.id, final);
              const finalData = final?.data as unknown as { items?: unknown };
              // 基于基础文本计算本轮修复后的全文，但不串联到后续运行
              let patchedTextForThisRun: string = baseText;
              if (finalData && Array.isArray(finalData.items)) {
                const patched = applyErrorItems(baseText, finalData.items as ErrorItem[]);
                patchedTextForThisRun = patched.patchedText;
              }
              // 透传本轮修复后的全文（仅用于展示/最终返回），不影响后续运行的输入
              yield { roleId: role.id, stage: 'final', payload: { ...(final.data as Record<string, unknown>), patchedText: patchedTextForThisRun }, runIndex: i };
              break;
            } else {
              const ev = r.value as RoleChunk;
              hooks?.onChunk?.(role.id, ev);
              yield { roleId: role.id, stage: 'chunk', payload: ev.data, runIndex: i };
            }
          }
        } else {
          // 非流式（Promise）
          const final = (await abortable(Promise.resolve(out), signal)) as RoleFinal;
          hooks?.onFinal?.(role.id, final);
          const finalData = final?.data as unknown as { items?: unknown };
          // 基于基础文本计算本轮修复后的全文，但不串联到后续运行
          let patchedTextForThisRun: string = baseText;
          if (finalData && Array.isArray(finalData.items)) {
            const patched = applyErrorItems(baseText, finalData.items as ErrorItem[]);
            patchedTextForThisRun = patched.patchedText;
          }
          // 透传本轮修复后的全文（仅用于展示/最终返回），不影响后续运行的输入
          yield { roleId: role.id, stage: 'final', payload: { ...(final.data as Record<string, unknown>), patchedText: patchedTextForThisRun }, runIndex: i };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const err = e instanceof Error ? e : new Error(msg);
        // 对于取消，直接向上抛出以尽快终止整条流水线
        if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
          hooks?.onError?.(role.id, err);
          throw err;
        }
        hooks?.onError?.(role.id, err);
        yield { roleId: role.id, stage: 'error', error: msg, runIndex: i };
        // 其他错误不中断整条流水线，继续下一个角色
      }
    }
  }
}
