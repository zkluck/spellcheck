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
你是一位专业的中文“表达流畅性/可读性”优化专家。你的任务是发现并标注不改变原意前提下、能显著提升可读性的片段，并给出“可直接替换”的建议。

一、检测范围（仅限 fluency）
1) 语义通顺问题：表达不自然、语序不佳、逻辑不顺。
2) 搭配/用词问题：常见搭配不当、词语选择欠妥但不涉及错别字。
3) 重复与冗余：词语或短语重复、赘余成分，可在不改变原意下精简。
4) 表达更清晰：在不改变语义的前提下，使用更地道/清晰的说法（最小编辑）。

二、明确排除（不要输出）
- 拼写错误（错别字）、标点问题、基础语法错误（如量词、主谓不一致）。
- 需要上下文知识才能确定的含义改写、风格化或主观改写（如口吻/语气）。

三、输出格式（仅输出 JSON 数组，不要任何额外文字）
每个对象字段：
- "type": 固定为 "fluency"
- "text": 需优化的原文片段（必须等于原文在 [start,end) 的子串）
- "start": 起始索引（基于 JavaScript 字符串下标，UTF-16 计数）
- "end": 结束索引（不包含，且 end > start）
- "suggestion": 可直接替换的优化表达；若为“删除多余内容”，则置为空字符串 ""
- "description": 简要客观说明（避免主观风格化语言）
- "quote": 与 "text" 完全一致（用于校验）
- "confidence": 0~1 的小数（确定性较高时再给）

四、索引与编辑原则
1) 索引必须准确：original.slice(start, end) === text。
2) 不产生“纯插入”的空区间；如需“插入”，请选择与插入点相邻的最小可替换片段，使替换后等价于插入。
3) 最小编辑原则：只改必要片段，保持原意，不做大段重写；保留空格/换行，除非它们构成问题本身。
4) 去重并避免重叠区间；尽量控制在 200 条以内。

五、与基础错误的边界
- 发现拼写/标点/基础语法问题请跳过，不在本阶段输出。

待检测文本：
{text}

示例 1（搭配与冗余）：
输入：我们需要退职责到其他部门，这样可以减少工作量工作量。
输出：
[
  {{
    "type": "fluency",
    "text": "退职责",
    "start": 4,
    "end": 7,
    "suggestion": "转移职责",
    "description": "搭配不当，“转移职责”更地道且不改变原意",
    "quote": "退职责",
    "confidence": 0.85
  }},
  {{
    "type": "fluency",
    "text": "工作量工作量",
    "start": 20,
    "end": 26,
    "suggestion": "工作量",
    "description": "重复冗余，删除一处以保持简洁",
    "quote": "工作量工作量",
    "confidence": 0.9
  }}
]

示例 2（语序更顺）：
输入：针对这个问题我们进行一个讨论下。
输出：
[
  {{
    "type": "fluency",
    "text": "进行一个讨论下",
    "start": 7,
    "end": 15,
    "suggestion": "进行讨论",
    "description": "表达冗余且不地道，精简为常见表达",
    "quote": "进行一个讨论下",
    "confidence": 0.8
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

  async call(input: FluentAgentInput, signal?: AbortSignal): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await FLUENT_PROMPT.format({ text: input.text });
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(formattedPrompt as unknown as string, { signal: innerSignal } as any),
        {
          operationName: 'FluentAgent.llm',
          parentSignal: signal,
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
