import { CoordinatorAgent } from '@/lib/langchain/agents/coordinator/CoordinatorAgent';
import { ErrorItem } from '@/types/error';
import { AnalyzeOptions, AgentResponse } from '@/types/agent';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

const coordinator = new CoordinatorAgent();

// 流式回调函数类型
type StreamCallback = (chunk: { agent: string; response: AgentResponse }) => void;

/**
 * 项目的主入口函数，用于分析文本中的错误。
 * @param text 要分析的文本。
 * @param options 分析选项，指定要启用的检测类型。
 * @param streamCallback 可选的回调函数，用于流式处理中间结果。
 * @param signal 可选的取消信号（通常来自 HTTP request.signal），用于中止后台 LLM 调用。
 * @returns 一个包含所有检测到的错误项的数组。
 */
export async function analyzeText(
  text: string,
  options: AnalyzeOptions,
  streamCallback?: StreamCallback,
  signal?: AbortSignal,
  context?: { reqId?: string },
): Promise<ErrorItem[]> {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // 使用内部 AbortController 将上游信号与超时合并，确保到时主动中止底层 LLM 调用
  const TIMEOUT_MS = config.langchain.analyzeTimeoutMs;
  const ac = new AbortController();
  let upstreamAbortListener: (() => void) | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const startedAt = Date.now();
    logger.info('analyze.start', { reqId: context?.reqId, enabledTypes: options.enabledTypes, textLength: text.length });

    // 若上游已中止，直接抛出
    if (signal?.aborted) {
      const err = new Error('analyzeText aborted by upstream');
      (err as any).name = 'AbortError';
      throw err;
    }

    // 合并上游中止
    if (signal) {
      upstreamAbortListener = () => ac.abort();
      signal.addEventListener('abort', upstreamAbortListener);
    }

    // 超时中止
    if (TIMEOUT_MS > 0 && Number.isFinite(TIMEOUT_MS)) {
      timeoutTimer = setTimeout(() => {
        ac.abort();
      }, TIMEOUT_MS);
    }

    // 直接调用 coordinator，并传入合并后的 signal
    const result = await coordinator.call({ text, options }, streamCallback, ac.signal, context);

    const elapsedMs = Date.now() - startedAt;
    logger.info('analyze.done', {
      reqId: context?.reqId,
      elapsedMs,
      resultCount: result.result?.length ?? 0,
      timeoutMs: TIMEOUT_MS,
    });
    return result.result;
  } catch (error) {
    const isAbort = (error as any)?.name === 'AbortError';
    const msg = (error as Error)?.message ?? String(error);
    logger.error('analyze.error', { reqId: context?.reqId, error: msg, aborted: isAbort });

    // 在流式传输中，错误已在 API 路由层处理，这里返回空数组即可
    if (streamCallback) {
      return [];
    }

    // 非流式：若为内部超时/中止，保持与旧行为一致抛出超时错误
    if (isAbort) {
      const err = new Error(`analyzeText timeout after ${TIMEOUT_MS}ms`);
      (err as any).name = 'AbortError';
      throw err;
    }
    throw error as Error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (signal && upstreamAbortListener) signal.removeEventListener('abort', upstreamAbortListener);
  }
}
