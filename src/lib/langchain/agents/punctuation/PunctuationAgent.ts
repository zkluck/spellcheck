import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { PUNCTUATION_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';

// 定义 PunctuationAgent 的输入结构
const PunctuationAgentInputSchema = z.object({
  text: z.string(),
});

type PunctuationAgentInput = z.infer<typeof PunctuationAgentInputSchema>;

/**
 * PunctuationAgent 负责检测文本中的标点符号错误。
 */
export class PunctuationAgent extends BaseAgent<PunctuationAgentInput> {
  constructor() {
    super('PunctuationAgent');
  }

  async call(input: PunctuationAgentInput): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await PUNCTUATION_PROMPT.format({ text: input.text });
      const response = await llm.invoke(formattedPrompt);
      // 统一解析与校验 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'punctuation',
        originalText: input.text,
      });

      return { result: processedErrors };
    } catch (error) {
      console.error('PunctuationAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
