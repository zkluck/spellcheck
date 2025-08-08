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
 * @returns 一个包含所有检测到的错误项的数组。
 */
export async function analyzeText(
  text: string, 
  options: AnalyzeOptions, 
  streamCallback?: StreamCallback
): Promise<ErrorItem[]> {
  if (!text || typeof text !== 'string') {
    return [];
  }

  try {
    const startedAt = Date.now();
    logger.info('analyzeText:start', { enabledTypes: options.enabledTypes, textLength: text.length });

    const TIMEOUT_MS = config.langchain.analyzeTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`analyzeText timeout after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
    });

    // 将 streamCallback 传递给 coordinator
    const result = await Promise.race([
      coordinator.call({ text, options }, streamCallback),
      timeoutPromise,
    ]);

    const elapsedMs = Date.now() - startedAt;
    logger.info('analyzeText:done', { 
      elapsedMs, 
      resultCount: result.result?.length ?? 0,
      timeoutMs: TIMEOUT_MS
    });
    return result.result;
  } catch (error) {
    logger.error('analyzeText:error', { error: (error as Error)?.message });
    // 在流式传输中，错误已在 API 路由层处理，这里返回空数组即可
    if (streamCallback) {
      return [];
    }
    // 对于非流式调用，向上抛出错误
    throw error;
  }
}
