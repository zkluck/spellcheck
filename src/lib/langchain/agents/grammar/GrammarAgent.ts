import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { GRAMMAR_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

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
      const responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      // 尝试从 LLM 的响应中解析 JSON
      let errors: Omit<ErrorItem, 'id'>[] = [];
      try {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)```/);
        const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText;
        errors = JSON.parse(jsonString);
      } catch (e) {
        console.error('GrammarAgent: 解析 LLM 响应失败', e);
        return { result: [] };
      }

      // 为每个错误添加唯一的 ID 和类型
      const processedErrors: ErrorItem[] = errors.map(error => ({
        ...error,
        id: uuidv4(),
        type: 'grammar',
      }));

      return { result: processedErrors };
    } catch (error) {
      console.error('GrammarAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
