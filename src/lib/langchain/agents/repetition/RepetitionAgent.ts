import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { REPETITION_PROMPT } from '@/lib/langchain/models/prompt-templates';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

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
      const responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      // 尝试从 LLM 的响应中解析 JSON
      let errors: Omit<ErrorItem, 'id'>[] = [];
      try {
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)```/);
        const jsonString = jsonMatch ? jsonMatch[1].trim() : responseText;
        errors = JSON.parse(jsonString);
      } catch (e) {
        console.error('RepetitionAgent: 解析 LLM 响应失败', e);
        return { result: [] };
      }

      // 为每个错误添加唯一的 ID 和类型
      const processedErrors: ErrorItem[] = errors.map(error => ({
        ...error,
        id: uuidv4(),
        type: 'repetition',
      }));

      return { result: processedErrors };
    } catch (error) {
      console.error('RepetitionAgent: 调用 LLM 时出错', error);
      return { result: [] };
    }
  }
}
