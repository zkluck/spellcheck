import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { PUNCTUATION_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

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
      const responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      // 尝试从 LLM 的响应中解析 JSON
      let errors: Omit<ErrorItem, 'id'>[] = [];
      try {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)```/);
        const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText;
        errors = JSON.parse(jsonString);
      } catch (e) {
        console.error('PunctuationAgent: 解析 LLM 响应失败', e);
        return { result: [] };
      }

      // 为每个错误添加唯一的 ID 和类型
      const processedErrors: ErrorItem[] = errors.map(error => ({
        ...error,
        id: uuidv4(),
        type: 'punctuation',
      }));

      return { result: processedErrors };
    } catch (error) {
      console.error('PunctuationAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
