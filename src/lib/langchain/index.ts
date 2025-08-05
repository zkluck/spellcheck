import { CoordinatorAgent } from '@/lib/langchain/agents/coordinator/CoordinatorAgent';
import { ErrorItem } from '@/types/error';
import { AnalyzeOptions } from '@/types/agent';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

const coordinator = new CoordinatorAgent();

/**
 * 项目的主入口函数，用于分析文本中的错误。
 * @param text 要分析的文本。
 * @param options 分析选项，指定要启用的检测类型。
 * @returns 一个包含所有检测到的错误项的数组。
 */
export async function analyzeText(text: string, options: AnalyzeOptions): Promise<ErrorItem[]> {
  if (!text || typeof text !== 'string') {
    return [];
  }

  try {
    const startedAt = Date.now();
    logger.info('analyzeText:start', { enabledTypes: options.enabledTypes, textLength: text.length });

    // 超时保护：从配置中读取超时阈值
    const TIMEOUT_MS = config.langchain.analyzeTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`analyzeText timeout after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
    });

    const result = await Promise.race([
      coordinator.call({ text, options }),
      timeoutPromise,
    ]) as { result: ErrorItem[] };

    const elapsedMs = Date.now() - startedAt;
    logger.info('analyzeText:done', { 
      elapsedMs, 
      resultCount: result.result?.length ?? 0,
      timeoutMs: TIMEOUT_MS
    });
    return result.result;
  } catch (error) {
    logger.error('analyzeText:error', { error: (error as Error)?.message });
    return [];
  }
}
