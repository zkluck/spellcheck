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
// BasicErrorAgent 的 Prompt 模板（ChatPromptTemplate）
const BASIC_ERROR_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
<ROLE_AND_GOAL>
你是一个严谨、专注的中文校对AI，你的唯一任务是检测文本中的基础性、客观性错误。
- 检测范围: 仅限于拼写 (spelling)、标点 (punctuation) 和基础语法 (grammar)。
- 核心原则: 绝对客观。严禁进行任何主观的风格美化、语气调整或需要外部知识才能判断的内容改写。宁可漏报，绝不误报。
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
你的唯一输出必须是一个 JSON 数组，即使没有发现错误（此时输出空数组 []）。
严禁在 JSON 数组前后添加任何说明文字、解释或 Markdown 代码块。

每个 JSON 对象代表一个错误，字段如下（所有字段必填）：
- "type": 错误类型，必须是 "spelling" | "punctuation" | "grammar" 之一。
- "text": 从原文中截取的、包含错误的最小文本片段。
- "start": 错误片段在原文中的起始位置 (UTF-16 索引)。
- "end": 错误片段在原文中的结束位置 (UTF-16 索引，且 end > start)。
- "suggestion": 修正后的建议。若为删除，则为空字符串 ""。
- "explanation": 对错误的简明、客观的解释。
- "quote": 与 "text" 完全一致。
- "confidence": 修正建议的置信度 (0.0-1.0)。仅输出高置信度 (>=0.9) 的错误。
</OUTPUT_FORMAT>

<RULES>
1. 索引精确: 必须满足 original.slice(start, end) === text，不跨越/虚构上下文。
2. 最小化编辑: 修正应尽可能小，只包含必要改动。
3. 禁止“纯插入”: 任何“插入”都需通过“替换”实现，选择与插入点相邻的最小片段，并在 suggestion 中包含新增内容。
4. 独立且不重叠: 每个错误项独立完整，(start, end) 区间之间不得重叠。
5. 数量约束: 最多输出 200 项。
6. 置信度门槛: 仅在把握高 (confidence >= 0.9) 时才输出该项。
7. 失败回避: 若无法严格保证索引与 text 完全匹配，请不要输出该项。
</RULES>

<EXAMPLES>
{examples}
</EXAMPLES>
`.trim()
  ],
  [
    'human',
    `
请严格按照上述 <OUTPUT_FORMAT> 和 <RULES> 在以下文本中检测基础错误。

<TEXT_TO_ANALYZE>
{text}
</TEXT_TO_ANALYZE>

如果提供了上一轮的校对信息，请参考它们来避免重复报告已修正的错误，但所有索引必须基于当前提供的原始文本 {text}。
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
  constructor() {
    super('BasicErrorAgent');
  }

  async call(input: AgentInputWithPrevious, signal?: AbortSignal): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const messages = await BASIC_ERROR_PROMPT.formatMessages({
        text: input.text,
        prevIssues: input.previous?.issuesJson ?? '',
        patchedText: input.previous?.patchedText ?? '',
        runIndex: String(input.previous?.runIndex ?? ''),
        examples: BASIC_ERROR_EXAMPLES,
      } as any);
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        {
          operationName: 'BasicErrorAgent.llm',
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
      
      // 分别处理不同类型的错误
      const allErrors: ErrorItem[] = [];
      
      for (const rawItem of rawItems) {
        if (rawItem && typeof rawItem === 'object' && 'type' in rawItem) {
          const type = rawItem.type;
          if (type === 'spelling' || type === 'punctuation' || type === 'grammar') {
            const processedErrors = toErrorItems([rawItem], {
              enforcedType: type,
              originalText: input.text,
              allowLocateByTextUnique: config.langchain.agents.basic.allowLocateFallback,
            });
            allErrors.push(...processedErrors);
          }
        }
      }

      // 根据配置决定是否强制仅保留索引精确匹配项
      const requireExact = config.langchain.agents.basic.requireExactIndex;
      const indexFiltered = requireExact
        ? allErrors.filter((e) => (e as any).metadata?.locate === 'exact')
        : allErrors;

      // 过滤低置信度项（严格执行 >= 配置阈值），从 metadata 中读取置信度
      const minC = config.langchain.agents.basic.minConfidence;
      const filteredErrors = indexFiltered.filter((e) => {
        const m = (e as any).metadata;
        const c = typeof m?.confidence === 'number' ? m.confidence : (typeof m?.originalLLM?.confidence === 'number' ? m.originalLLM.confidence : undefined);
        return typeof c === 'number' && c >= minC;
      });

      // 返回前强制裁剪最大数量
      const maxN = config.langchain.agents.basic.maxOutput;
      const finalErrors = filteredErrors.slice(0, Math.max(0, maxN || 0));

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
