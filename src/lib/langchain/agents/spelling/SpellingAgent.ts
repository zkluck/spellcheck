import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { SPELLING_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';

// 定义 SpellingAgent 的输入结构
const SpellingAgentInputSchema = z.object({
  text: z.string(),
});

type SpellingAgentInput = z.infer<typeof SpellingAgentInputSchema>;

/**
 * SpellingAgent 负责检测文本中的拼写错误。
 */
export class SpellingAgent extends BaseAgent<SpellingAgentInput> {
  constructor() {
    super('SpellingAgent');
  }

  async call(input: SpellingAgentInput): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await SPELLING_PROMPT.format({ text: input.text });
      const response = await llm.invoke(formattedPrompt);
      // 统一解析与校验 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'spelling',
        originalText: input.text,
      });

      return { result: processedErrors };
    } catch (error) {
      console.error('SpellingAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
