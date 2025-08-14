import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import type { AgentInputWithPrevious } from '@/types/schemas';
import { AgentResponseSchema } from '@/types/schemas';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

// 将包含 JSON 花括号的示例放到变量里，避免 ChatPromptTemplate 把花括号当占位符解析
const FLUENT_EXAMPLES = `
- 示例1: 语序优化（最小替换）
  输入: "这个问题我觉得可能不太好回答。"
  输出:
  [
    {
      "type": "fluency",
      "text": "我觉得可能",
      "start": 3,
      "end": 8,
      "suggestion": "可能我觉得",
      "explanation": "语序调整更自然，含义不变。",
      "quote": "我觉得可能",
      "confidence": 0.9
    }
  ]

- 示例2: 冗余删除
  输入: "有点点复杂。"
  输出:
  [
    {
      "type": "fluency",
      "text": "点",
      "start": 2,
      "end": 3,
      "suggestion": "",
      "explanation": "重复用词，删除更简洁。",
      "quote": "点",
      "confidence": 0.92
    }
  ]

- 示例3: 更地道的等价表达
  输入: "我们会进行一个讨论。"
  输出:
  [
    {
      "type": "fluency",
      "text": "进行一个讨论",
      "start": 3,
      "end": 9,
      "suggestion": "讨论",
      "explanation": "冗词化表达，简化更自然，语义不变。",
      "quote": "进行一个讨论",
      "confidence": 0.95
    }
  ]

- 示例4: 无优化
  输入: "今天天气很好，我们去公园散步吧。"
  输出:
  []
`;

// FluentAgent 的 Prompt 模板（ChatPromptTemplate）
const FLUENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
<ROLE_AND_GOAL>
你是中文“表达流畅性/可读性”优化专家，仅在不改变原意前提下提出最小编辑的替换建议。
- 范围: 语义通顺、搭配/用词、重复与冗余、更清晰的等价表达。
- 排除: 拼写/标点/基础语法错误；需要外部知识的改写；主观风格化改写。
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
你的唯一输出必须是一个 JSON 数组，即使没有建议（此时输出空数组 []）。严禁任何额外文字或 Markdown。

每个 JSON 对象字段如下（所有字段必填）：
- "type": 固定为 "fluency"。
- "text": 原文中包含问题的最小片段。
- "start": 片段起始 UTF-16 索引。
- "end": 片段结束 UTF-16 索引（end > start）。
- "suggestion": 修正后的更流畅表达；若为删除则为空字符串 ""。
- "explanation": 简明客观说明，避免主观化。
- "quote": 与 "text" 完全一致。
- "confidence": 0.0-1.0 的置信度，仅在把握高时给出。
</OUTPUT_FORMAT>

<RULES>
1. 索引精确：必须满足 original.slice(start, end) === text。
2. 最小编辑：仅做必要的最小替换，禁止大段改写。
3. 禁止纯插入：如需“插入”，通过最小替换实现。
4. 不重叠：各 (start,end) 区间不得重叠。
5. 数量约束：最多输出 200 项。
6. 失败回避：无法保证索引与 text 完全匹配时不要输出。
</RULES>

<EXAMPLES>
{examples}
</EXAMPLES>
`.trim()
  ],
  [
    'human',
    `
请严格按照上述 <OUTPUT_FORMAT> 和 <RULES> 在以下文本中检测流畅性问题。

<TEXT_TO_ANALYZE>
{text}
</TEXT_TO_ANALYZE>

参考（若提供）：
- 上一轮问题 (JSON): {prevIssues}
- 已修复文本 (供参考): {patchedText}
- 迭代编号: {runIndex}
`.trim()
  ],
]);

/**
 * FluentAgent 负责检测语义通顺和表达优化问题
 */
export class FluentAgent extends BaseAgent<AgentInputWithPrevious> {
  constructor() {
    super('FluentAgent');
  }

  async call(input: AgentInputWithPrevious, signal?: AbortSignal): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const messages = await FLUENT_PROMPT.formatMessages({
        text: input.text,
        prevIssues: input.previous?.issuesJson ?? '',
        patchedText: input.previous?.patchedText ?? '',
        runIndex: String(input.previous?.runIndex ?? ''),
        examples: FLUENT_EXAMPLES,
      } as any);
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        {
          operationName: 'FluentAgent.llm',
          parentSignal: signal,
          logFields: {
            text: input.text,
            previous: {
              issuesJson: input.previous?.issuesJson ?? '',
              patchedText: input.previous?.patchedText ?? '',
              runIndex: input.previous?.runIndex,
            },
          },
        }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      // 统一解析 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      const processedErrors: ErrorItem[] = toErrorItems(rawItems, {
        enforcedType: 'fluency',
        originalText: input.text,
        allowLocateByTextUnique: config.langchain.agents.fluent.allowLocateFallback,
      });

      // 根据配置进行索引严格性与置信度过滤，并裁剪数量
      const requireExact = config.langchain.agents.fluent.requireExactIndex;
      const indexFiltered = requireExact
        ? processedErrors.filter((e) => (e as any).metadata?.locate === 'exact')
        : processedErrors;

      const minC = config.langchain.agents.fluent.minConfidence;
      const confidenceFiltered = indexFiltered.filter((e) => {
        const m = (e as any).metadata;
        const c = typeof m?.confidence === 'number' ? m.confidence : (typeof m?.originalLLM?.confidence === 'number' ? m.originalLLM.confidence : undefined);
        return typeof c === 'number' && c >= minC;
      });

      const maxN = config.langchain.agents.fluent.maxOutput;
      const finalErrors = confidenceFiltered.slice(0, Math.max(0, maxN || 0));

      const parsedOut = AgentResponseSchema.safeParse({ result: finalErrors, rawOutput });
      if (!parsedOut.success) {
        logger.warn('FluentAgent.output_invalid', { zod: parsedOut.error.flatten?.() ?? String(parsedOut.error) });
        return { result: [], error: 'FluentAgent.invalid_output', rawOutput } as AgentResponse;
      }
      return parsedOut.data as AgentResponse;
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
