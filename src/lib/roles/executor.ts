/*
 * 角色流水线执行器：顺序执行给定的角色序列，支持多次运行与简单流式事件
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


export async function* runPipeline(opts: {
  roles: PipelineEntry[];
  input: AnalysisInput;
  signal?: AbortSignal;
  hooks?: ExecutorHooks;
  metadata?: Record<string, unknown>;
}): AsyncGenerator<SSEEvent> {
  const { roles, input, signal, hooks, metadata } = opts;

  // 当前被分析/修复的文本，默认从入口文本开始
  let currentText: string = input.text;

  for (const entry of roles) {
    const { id, runs } = entry;
    const role = getRole(id);
    if (!role) {
      yield { roleId: id, stage: 'error', error: `role_not_found: ${id}` };
      hooks?.onError?.(id, new Error(`role_not_found: ${id}`));
      continue;
    }

    for (let i = 0; i < Math.max(1, runs || 1); i++) {
      hooks?.onStart?.(role.id);
      yield { roleId: role.id, stage: 'start' };

      const ctx: RoleContext = {
        signal,
        metadata: { ...(metadata || {}), runIndex: i, modelName: entry.modelName },
      };

      try {
        // 关键：为下一个/本次角色提供已修复的最新文本
        const out = role.run({ ...input, text: currentText }, ctx);
        if (isAsyncGenerator<RoleChunk>(out)) {
          // 流式适配：手动迭代以拿到最终返回值
          while (true) {
            const r = await out.next();
            if (r.done) {
              const final = r.value as RoleFinal;
              hooks?.onFinal?.(role.id, final);
              const finalData = final?.data as unknown as { items?: unknown };
              if (finalData && Array.isArray(finalData.items)) {
                const patched = applyErrorItems(currentText, finalData.items as ErrorItem[]);
                currentText = patched.patchedText;
              }
              // 透传本轮修复后的全文
              yield { roleId: role.id, stage: 'final', payload: { ...(final.data as Record<string, unknown>), patchedText: currentText } };
              break;
            } else {
              const ev = r.value as RoleChunk;
              hooks?.onChunk?.(role.id, ev);
              yield { roleId: role.id, stage: 'chunk', payload: ev.data };
            }
          }
        } else {
          // 非流式（Promise）
          const final = (await out) as RoleFinal;
          hooks?.onFinal?.(role.id, final);
          const finalData = final?.data as unknown as { items?: unknown };
          if (finalData && Array.isArray(finalData.items)) {
            const patched = applyErrorItems(currentText, finalData.items as ErrorItem[]);
            currentText = patched.patchedText;
          }
          // 透传本轮修复后的全文
          yield { roleId: role.id, stage: 'final', payload: { ...(final.data as Record<string, unknown>), patchedText: currentText } };
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const err = e instanceof Error ? e : new Error(msg);
        hooks?.onError?.(role.id, err);
        yield { roleId: role.id, stage: 'error', error: msg };
        // 出错不中断整条流水线，继续下一个角色
      }
    }
  }
}
