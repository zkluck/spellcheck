import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { PromptTemplate } from '@langchain/core/prompts';

// 定义 BasicErrorAgent 的输入结构
const BasicErrorAgentInputSchema = z.object({
  text: z.string(),
});

type BasicErrorAgentInput = z.infer<typeof BasicErrorAgentInputSchema>;

// BasicErrorAgent 的 Prompt 模板
const BASIC_ERROR_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
你是一位专业的中文文本基础错误检测专家。你的任务是检测文本中的客观、明确的基础错误。

检测范围（必须严格遵守）：
1. **拼写错误**：错别字、同音字误用（如"利害"应为"厉害"）
2. **标点符号错误**：缺失、多余、类型错误、全半角混用
3. **基础语法错误**：明显的语法结构错误（如量词搭配、主谓不一致）

不检测范围（严格排除）：
- 语义通顺问题、表达优化建议
- 复杂的语言风格问题
- 主观的表达改进建议

输出要求：
1) 仅输出 JSON 数组，不要任何额外文字
2) 每个错误对象包含：
   - "type": 错误类型（必须是 spelling | punctuation | grammar 之一）
   - "text": 错误文本（必须与原文完全一致）
   - "start": 错误起始索引（基于 JavaScript 字符串下标，UTF-16 计数方式）
   - "end": 错误结束索引（不包含）
   - "suggestion": 建议修改
   - "description": 错误说明
   - "quote": 原文引用（与 text 字段一致，用于校验）
   - "confidence": 置信度，0~1 之间的小数
3) 索引必须准确：text 必须等于原文在 [start, end) 的子串
4) 只检测确定的、客观的错误，不确定时不报错

待检查文本：
{text}

示例：
输入：他是一个很利害的人，买了一棵苹果
输出：
[
  {{
    "type": "spelling",
    "text": "利害",
    "start": 6,
    "end": 8,
    "suggestion": "厉害",
    "description": "'利害'应为'厉害'，属于同音字误用。"
  }},
  {{
    "type": "grammar",
    "text": "一棵苹果",
    "start": 12,
    "end": 16,
    "suggestion": "一个苹果",
    "description": "量词使用错误，'苹果'应该用'个'而不是'棵'。"
  }}
]
`,
});

/**
 * BasicErrorAgent 负责检测基础的、客观的错误：拼写、标点、基础语法
 */
export class BasicErrorAgent extends BaseAgent<BasicErrorAgentInput> {
  constructor() {
    super('BasicErrorAgent');
  }

  async call(input: BasicErrorAgentInput): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await BASIC_ERROR_PROMPT.format({ text: input.text });
      const response = await llm.invoke(formattedPrompt);
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      // 统一解析 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      
      // 分别处理不同类型的错误
      const allErrors: ErrorItem[] = [];
      
      for (const rawItem of rawItems) {
        if (rawItem && typeof rawItem === 'object' && 'type' in rawItem) {
          const type = rawItem.type;
          if (type === 'spelling' || type === 'punctuation' || type === 'grammar') {
            const processedErrors = toErrorItems([rawItem], {
              enforcedType: type,
              originalText: input.text,
            });
            allErrors.push(...processedErrors);
          }
        }
      }

      return { 
        result: allErrors,
        rawOutput
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('BasicErrorAgent: 调用 LLM 时出错', error);
      return { 
        result: [],
        error: errorMessage
      };
    }
  }
}
