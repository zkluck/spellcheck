import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { REPETITION_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';

// 定义 RepetitionAgent 的输入结构
const RepetitionAgentInputSchema = z.object({
  text: z.string(),
});

type RepetitionAgentInput = z.infer<typeof RepetitionAgentInputSchema>;

/**
 * RepetitionAgent 负责检测文本中的重复词语或句子。
 */
export class RepetitionAgent extends BaseAgent<RepetitionAgentInput> {
  constructor() {
    super('RepetitionAgent');
  }

  async call(input: RepetitionAgentInput): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await REPETITION_PROMPT.format({ text: input.text });
      const response = await llm.invoke(formattedPrompt);
      // 统一解析与校验 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'repetition',
        originalText: input.text,
      });

      return { result: processedErrors };
    } catch (error) {
      console.error('RepetitionAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
