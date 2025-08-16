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
const BASIC_ERROR_EXAMPLES = `
- 示例1: 拼写错误（纯 JSON，无代码块）
  输入: "我今天很高行。"
  输出:
  [
    {
      "type": "spelling",
      "text": "高行",
      "start": 4,
      "end": 6,
      "suggestion": "高兴",
      "explanation": "“行”是错别字，根据上下文应为“兴”。",
      "quote": "高行",
      "confidence": 0.99
    }
  ]

- 示例2: 标点冗余（删除/替换）
  输入: "你好呀！！"
  输出:
  [
    {
      "type": "punctuation",
      "text": "！！",
      "start": 3,
      "end": 5,
      "suggestion": "！",
      "explanation": "感叹号通常只使用一个。",
      "quote": "！！",
      "confidence": 0.95
    }
  ]

- 示例3: 通过替换实现“插入”标点
  输入: "他问你还好吗"
  输出:
  [
    {
      "type": "punctuation",
      "text": "你还好吗",
      "start": 2,
      "end": 6,
      "suggestion": "“你还好吗？”",
      "explanation": "直接引用的问句应使用引号和问号。",
      "quote": "你还好吗",
      "confidence": 0.9
    }
  ]

- 示例4: 语法错误（量词）
  输入: "我买了一匹书。"
  输出:
  [
    {
      "type": "grammar",
      "text": "一匹书",
      "start": 3,
      "end": 6,
      "suggestion": "一本书",
      "explanation": "量词使用错误，“匹”通常用于马，书的量词应为“本”。",
      "quote": "一匹书",
      "confidence": 1.0
    }
  ]

- 示例5: 纯删除示例（冗余空格）
  输入: "我们  一起走。"
  输出:
  [
    {
      "type": "grammar",
      "text": "  ",
      "start": 2,
      "end": 4,
      "suggestion": "",
      "explanation": "重复空格应删除为单个空格。",
      "quote": "  ",
      "confidence": 0.95
    }
  ]

- 示例6: 无错误
  输入: "今天天气真好，我们去公园散步吧。"
  输出:
  []
`;
// —— 流畅性（Fluency）示例 ——
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
// —— 合并后的 Prompt（基础错误 + 流畅性，统一一次性返回） ——
const COMBINED_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
<ROLE_AND_GOAL>
你是一个严谨、专注的中文文本审校专家。请在不引入主观风格改写、且不依赖外部知识的前提下，
检测并返回以下两类问题，统一以一个 JSON 数组返回：
- 基础错误：拼写 (spelling)、标点 (punctuation)、基础语法 (grammar)；
- 表达流畅性：fluency（在不改变原意的前提下进行最小替换的可读性/搭配/冗余等优化）。
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
你的唯一输出必须是一个 JSON 数组（可为空 []），不得包含说明文字或 Markdown 代码块。
数组中的每个对象包含以下字段（所有字段必填）：
- "type": "spelling" | "punctuation" | "grammar" | "fluency" 之一；
- "text": 从原文中截取的、包含问题的最小片段；
- "start": 片段在原文中的起始 UTF-16 索引；
- "end": 片段在原文中的结束 UTF-16 索引（必须 > start）；
- "suggestion": 修正/替换建议；若为删除则为空字符串 ""；
- "explanation": 简明、客观的说明；
- "quote": 与 "text" 完全一致；
- "confidence": 0.0-1.0 的置信度，仅在把握高时输出该项。
</OUTPUT_FORMAT>

<RULES>
1. 索引精确：必须满足 original.slice(start, end) === text。
2. 最小编辑：仅做必要的最小替换，禁止大段改写与主观润色。
3. 禁止纯插入：如需“插入”，通过最小替换实现，并在 suggestion 中体现新增内容。
4. 不重叠：所有 (start,end) 区间之间不得重叠。
5. 数量上限：最多输出 200 项。
6. 失败回避：若无法严格保证索引与 text 完全匹配，请不要输出该项。
</RULES>

<EXAMPLES>
【基础错误】
{basicExamples}

【流畅性】
{fluentExamples}
</EXAMPLES>
`.trim()
  ],
  [
    'human',
    `
请严格按照上述 <OUTPUT_FORMAT> 和 <RULES> 在以下文本中检测问题，并统一返回：

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
 * BasicErrorAgent 负责检测基础的、客观的错误：拼写、标点、基础语法
 */
export class BasicErrorAgent extends BaseAgent<AgentInputWithPrevious> {
  private modelName?: string;
  constructor(opts?: { modelName?: string }) {
    super('BasicErrorAgent');
    this.modelName = opts?.modelName;
  }

  async call(input: AgentInputWithPrevious, signal?: AbortSignal): Promise<AgentResponse> {
    const llm = getLLM({ modelName: this.modelName });

    try {
      const messages = await COMBINED_PROMPT.formatMessages({
        text: input.text,
        prevIssues: input.previous?.issuesJson ?? '',
        patchedText: input.previous?.patchedText ?? '',
        runIndex: String(input.previous?.runIndex ?? ''),
        basicExamples: BASIC_ERROR_EXAMPLES,
        fluentExamples: FLUENT_EXAMPLES,
      } as any);
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        {
          operationName: 'BasicErrorAgent.combined.llm',
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
      
      // 分类型处理与过滤
      const basicItems: ErrorItem[] = [];
      const fluentItems: ErrorItem[] = [];
      for (const rawItem of rawItems) {
        if (rawItem && typeof rawItem === 'object' && 'type' in rawItem) {
          const type = (rawItem as any).type;
          if (type === 'spelling' || type === 'punctuation' || type === 'grammar') {
            const processed = toErrorItems([rawItem], {
              enforcedType: type,
              originalText: input.text,
              allowLocateByTextUnique: config.langchain.agents.basic.allowLocateFallback,
            });
            basicItems.push(...processed);
          } else if (type === 'fluency') {
            const processed = toErrorItems([rawItem], {
              enforcedType: 'fluency',
              originalText: input.text,
              allowLocateByTextUnique: config.langchain.agents.basic.fluency.allowLocateFallback,
            });
            fluentItems.push(...processed);
          }
        }
      }

      // 基础错误过滤（精确索引与置信度）
      const basicExact = config.langchain.agents.basic.requireExactIndex
        ? basicItems.filter((e) => (e as any).metadata?.locate === 'exact')
        : basicItems;
      const basicFiltered = basicExact.filter((e) => {
        const m = (e as any).metadata;
        const c = typeof m?.confidence === 'number' ? m.confidence : (typeof m?.originalLLM?.confidence === 'number' ? m.originalLLM.confidence : undefined);
        return typeof c === 'number' && c >= config.langchain.agents.basic.minConfidence;
      }).slice(0, Math.max(0, config.langchain.agents.basic.maxOutput || 0));

      // 流畅性过滤（精确索引与置信度）
      const fluentExact = config.langchain.agents.basic.fluency.requireExactIndex
        ? fluentItems.filter((e) => (e as any).metadata?.locate === 'exact')
        : fluentItems;
      const fluentFiltered = fluentExact.filter((e) => {
        const m = (e as any).metadata;
        const c = typeof m?.confidence === 'number' ? m.confidence : (typeof m?.originalLLM?.confidence === 'number' ? m.originalLLM.confidence : undefined);
        return typeof c === 'number' && c >= config.langchain.agents.basic.fluency.minConfidence;
      }).slice(0, Math.max(0, config.langchain.agents.basic.fluency.maxOutput || 0));

      const finalErrors = [...basicFiltered, ...fluentFiltered];

      const parsedOut = AgentResponseSchema.safeParse({ result: finalErrors, rawOutput });
      if (!parsedOut.success) {
        logger.warn('BasicErrorAgent.output_invalid', { zod: parsedOut.error.flatten?.() ?? String(parsedOut.error) });
        return { result: [], error: 'BasicErrorAgent.invalid_output', rawOutput } as AgentResponse;
      }
      return parsedOut.data as AgentResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('BasicErrorAgent.invoke.error', { error: errorMessage });
      return { 
        result: [],
        error: errorMessage
      };
    }
  }
}

