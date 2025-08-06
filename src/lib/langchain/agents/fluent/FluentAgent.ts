import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { PromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';

// 定义 FluentAgent 的输入结构
const FluentAgentInputSchema = z.object({
  text: z.string(),
});

type FluentAgentInput = z.infer<typeof FluentAgentInputSchema>;

// FluentAgent 的 Prompt 模板
const FLUENT_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
你是一位专业的中文语言表达优化专家。你的任务是检测文本中的语义通顺和表达优化问题。

检测范围（必须严格遵守）：
1. **语义通顺问题**：表达不自然、语句不通顺、逻辑不清晰
2. **词语搭配问题**：词汇搭配不当、表达方式可以优化
3. **重复冗余问题**：词语重复、表达冗余、信息重复
4. **表达优化**：可以更清晰、更准确的表达方式

不检测范围（严格排除）：
- 明确的拼写错误（错别字）
- 标点符号的使用问题
- 基础的语法结构错误（量词搭配等）

输出要求：
1) 仅输出 JSON 数组，不要任何额外文字
2) 每个错误对象包含：
   - "type": 错误类型（必须是 fluency）
   - "text": 需要优化的文本片段
   - "start": 起始索引（基于 JavaScript 字符串下标）
   - "end": 结束索引（不包含）
   - "suggestion": 建议的优化表达
   - "description": 优化说明
3) 索引必须准确：text 必须等于原文在 [start, end) 的子串
4) 专注于语义层面的优化，不涉及基础错误修正

待检查文本：
{text}

示例：
输入：我们需要退职责到其他部门，这样可以减少工作量工作量。
输出：
[
  {{
    "type": "fluency",
    "text": "退职责",
    "start": 4,
    "end": 7,
    "suggestion": "转移职责",
    "description": "'退职责'表达不够准确，'转移职责'更符合语言习惯。"
  }},
  {{
    "type": "fluency",
    "text": "工作量工作量",
    "start": 20,
    "end": 26,
    "suggestion": "工作量",
    "description": "'工作量'重复，应删除重复部分。"
  }}
]
`,
});

/**
 * FluentAgent 负责检测语义通顺和表达优化问题
 */
export class FluentAgent extends BaseAgent<FluentAgentInput> {
  constructor() {
    super('FluentAgent');
  }

  async call(input: FluentAgentInput): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await FLUENT_PROMPT.format({ text: input.text });
      const response = await guardLLMInvoke(
        (signal) => llm.invoke(formattedPrompt as unknown as string, { signal } as any),
        {
          operationName: 'FluentAgent.llm',
        }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      // 统一解析 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'fluency',
        originalText: input.text,
      });

      return { 
        result: processedErrors,
        rawOutput
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('FluentAgent.invoke.error', { error: errorMessage });
      return { 
        result: [],
        error: errorMessage
      };
    }
  }
}
