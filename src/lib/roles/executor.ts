/*
 * 角色流水线执行器：顺序执行给定的角色序列，支持多次运行与简单流式事件
 */
import { getRole } from './registry';
import type {
  AnalysisInput,
  ExecutorHooks,
  PipelineEntry,
  RoleContext,
  RoleFinal,
  RoleChunk,
  SSEEvent,
} from './types';

export async function* runPipeline(opts: {
  roles: PipelineEntry[];
  input: AnalysisInput;
  signal?: AbortSignal;
  hooks?: ExecutorHooks;
  metadata?: Record<string, unknown>;
}): AsyncGenerator<SSEEvent> {
  const { roles, input, signal, hooks, metadata } = opts;

  // 累积前置产物，供下游角色（如 reviewer）参考
  let previousItems: any[] = [];

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
        metadata: { previousItems, runIndex: i, ...(metadata || {}), modelName: entry.modelName },
      };

      try {
        const out = role.run(input, ctx) as any;
        if (out && typeof out[Symbol.asyncIterator] === 'function') {
          // 流式适配
          for await (const ev of out as AsyncGenerator<RoleChunk | RoleFinal>) {
            if ((ev as RoleChunk).type === 'chunk') {
              hooks?.onChunk?.(role.id, ev as RoleChunk);
              yield { roleId: role.id, stage: 'chunk', payload: (ev as RoleChunk).data };
            } else if ((ev as RoleFinal).type === 'final') {
              hooks?.onFinal?.(role.id, ev as RoleFinal);
              const finalData: any = (ev as RoleFinal).data;
              // 约定：最终结果若包含 items 则纳入 previousItems
              if (finalData && Array.isArray(finalData.items)) {
                previousItems = finalData.items;
              }
              yield { roleId: role.id, stage: 'final', payload: finalData };
            }
          }
        } else {
          // 非流式（Promise）
          const final = (await out) as RoleFinal;
          hooks?.onFinal?.(role.id, final);
          const finalData: any = final?.data;
          if (finalData && Array.isArray(finalData.items)) {
            previousItems = finalData.items;
          }
          yield { roleId: role.id, stage: 'final', payload: finalData };
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
