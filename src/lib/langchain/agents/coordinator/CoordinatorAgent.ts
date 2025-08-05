import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { GrammarAgent } from '@/lib/langchain/agents/grammar/GrammarAgent';
import { SpellingAgent } from '@/lib/langchain/agents/spelling/SpellingAgent';
import { PunctuationAgent } from '@/lib/langchain/agents/punctuation/PunctuationAgent';
import { RepetitionAgent } from '@/lib/langchain/agents/repetition/RepetitionAgent';
import { IntegrationAgent } from '@/lib/langchain/agents/integration/IntegrationAgent';
import { z } from 'zod';
import { logger } from '@/lib/logger';

// 定义 CoordinatorAgent 的输入结构
const CoordinatorAgentInputSchema = z.object({
  text: z.string(),
  options: z.object({
    enabledTypes: z.array(
      z.enum(['grammar', 'spelling', 'punctuation', 'repetition'])
    ),
  }),
});

type CoordinatorAgentInput = z.infer<typeof CoordinatorAgentInputSchema>;

/**
 * CoordinatorAgent 负责协调所有子智能体的工作流程。
 */
export class CoordinatorAgent {
  private grammarAgent: GrammarAgent;
  private spellingAgent: SpellingAgent;
  private punctuationAgent: PunctuationAgent;
  private repetitionAgent: RepetitionAgent;
  private integrationAgent: IntegrationAgent;

  constructor() {
    this.grammarAgent = new GrammarAgent();
    this.spellingAgent = new SpellingAgent();
    this.punctuationAgent = new PunctuationAgent();
    this.repetitionAgent = new RepetitionAgent();
    this.integrationAgent = new IntegrationAgent();
  }

  async call(input: CoordinatorAgentInput): Promise<AgentResponse> {
    const { text, options } = input;
    const { enabledTypes } = options;

    const promises: Promise<AgentResponse>[] = [];

    if (enabledTypes.includes('grammar')) {
      promises.push(this.grammarAgent.call({ text }));
    }
    if (enabledTypes.includes('spelling')) {
      promises.push(this.spellingAgent.call({ text }));
    }
    if (enabledTypes.includes('punctuation')) {
      promises.push(this.punctuationAgent.call({ text }));
    }
    if (enabledTypes.includes('repetition')) {
      promises.push(this.repetitionAgent.call({ text }));
    }

    // 等待所有选中的智能体完成（允许部分失败）
    const settled = await Promise.allSettled(promises);
    const rawResults: AgentResponse[] = [];
    settled.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        rawResults.push(res.value);
      } else {
        logger.warn('Agent failed', { index: idx, reason: (res.reason as Error)?.message });
      }
    });

    // 提取所有错误项到一个数组中
    const allErrors = rawResults.map((result) => result.result);

    // 2. **关键步骤**: 重新计算所有错误项的索引，不再信任 LLM 返回的 start/end
    // 我们只信任 LLM 返回的 'text' 字段，并以此为据在原文中重新定位。
    const reindexedResults: ErrorItem[][] = allErrors.map((errorList) => {
      // **关键修复**: 为每个智能体的错误列表重置搜索起始点
      let searchStartIndex = 0;
      if (!errorList) return [];
      // 遍历每个智能体返回的错误列表
      return errorList
        .map((error: ErrorItem) => {
          const errorText = error.text.trim();
          const newStartIndex = text.indexOf(errorText, searchStartIndex);

          if (newStartIndex !== -1) {
            // 找到匹配项，更新其索引并为下一次搜索更新起始位置
            searchStartIndex = newStartIndex + errorText.length;
            return {
              ...error,
              start: newStartIndex,
              end: newStartIndex + errorText.length,
            };
          }
          // 如果在文本中找不到完全匹配的错误文本，则返回 null，后续将被过滤掉
          return null;
        })
        .filter((error): error is ErrorItem => error !== null); // 过滤掉未找到匹配的项
    });

    // 3. 使用重新计算过索引的、可靠的数据进行整合
    const finalResult = await this.integrationAgent.call({
      text,
      errors: reindexedResults,
    });

    return finalResult;
  }
}
