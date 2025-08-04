import { CoordinatorAgent } from '@/lib/langchain/agents/coordinator/CoordinatorAgent';
import { ErrorItem } from '@/types/error';

// 定义 analyzeText 函数的选项结构
interface AnalyzeOptions {
  enabledTypes: Array<'grammar' | 'spelling' | 'punctuation' | 'repetition'>;
}

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
    const result = await coordinator.call({ text, options });
    return result.result;
  } catch (error) {
    console.error('在 analyzeText 中捕获到未处理的错误:', error);
    return [];
  }
}
