import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { GRAMMAR_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';

// 定义 GrammarAgent 的输入结构
const GrammarAgentInputSchema = z.object({
  text: z.string(),
});

type GrammarAgentInput = z.infer<typeof GrammarAgentInputSchema>;

/**
 * GrammarAgent 负责检测文本中的语法错误。
 */
export class GrammarAgent extends BaseAgent<GrammarAgentInput> {
  constructor() {
    super('GrammarAgent');
  }

  async call(input: GrammarAgentInput): Promise<AgentResponse> {
    const llm = getLLM();
    
    try {
      const formattedPrompt = await GRAMMAR_PROMPT.format({ text: input.text });
      const response = await llm.invoke(formattedPrompt);
      // 统一解析与校验 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'grammar',
        originalText: input.text,
      });

      return { result: processedErrors };
    } catch (error) {
      console.error('GrammarAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
