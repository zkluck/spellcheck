import { BaseAgent } from '../base/BaseAgent';
import { AgentInputWithPrevious, AgentResponseOutput } from '@/types/schemas';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { ErrorItem, ErrorItemSchema } from '@/types/error';
import { AgentResponseSchema } from '@/types/schemas';
import { ruleEngine } from '@/lib/rules/engine';
import { ResultPostProcessor } from '@/lib/rules/postprocessor';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';

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
你是一个专业的中文文本校对专家，具备深厚的语言学功底。请严格按照以下标准检测文本问题：

**检测范围：**
1. 拼写错误 (spelling)：错别字、同音字误用、的/地/得混用
2. 标点符号 (punctuation)：标点使用错误、重复标点、缺失标点
3. 语法错误 (grammar)：量词搭配、语序问题、语法结构错误
4. 表达流畅性 (fluency)：冗余表达、不自然搭配、可优化的表述

**质量要求：**
- 高置信度：只输出确定性高的错误，避免主观判断
- 最小干预：保持原文风格，不进行大幅改写
- 精确定位：确保索引位置完全准确
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
输出格式：纯 JSON 数组，无其他文字。每个错误对象包含：
- "type": 错误类型 ("spelling"|"punctuation"|"grammar"|"fluency")
- "text": 原文错误片段（必须与索引位置完全匹配）
- "start": 起始索引位置（UTF-16）
- "end": 结束索引位置（UTF-16）
- "suggestion": 修正建议（删除时为空字符串）
- "explanation": 错误说明（简洁明确）
- "quote": 与text字段相同
- "confidence": 置信度（0.0-1.0，高置信度才输出）
</OUTPUT_FORMAT>

<DETECTION_STRATEGY>
**拼写检测重点：**
- 的/地/得：修饰名词用"的"，修饰动词用"地"，补语前用"得"
- 常见错别字：在/再、做/作、像/象、以/已等
- 同音字误用：根据语境判断正确用字

**标点检测重点：**
- 重复标点：！！、？？、。。。等应简化
- 引号配对：确保引号正确配对使用
- 逗号顿号：并列关系使用顿号，其他用逗号

**语法检测重点：**
- 量词搭配：人用"位"，书用"本"，车用"辆"等
- 语序问题：主谓宾、定状补的正确顺序
- 结构完整：避免成分残缺

**流畅性检测重点：**
- 冗余删除：去除不必要的重复词汇
- 搭配优化：改善不自然的词语搭配
- 表达简化：将复杂表述简化为自然表达
</DETECTION_STRATEGY>

<EXAMPLES>
【基础错误示例】
{basicExamples}

【流畅性示例】
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

  async call(input: AgentInputWithPrevious, signal?: AbortSignal): Promise<AgentResponseOutput> {
    const llm = getLLM({ modelName: this.modelName });

    try {
      // 首先使用规则引擎检测
      const ruleResults = config.detection.ruleEngine.enabled 
        ? ruleEngine.detect(input.text)
        : [];

      // 然后使用 LLM 检测
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

      const llmErrors = [...basicFiltered, ...fluentFiltered];

      // 使用后处理器合并和优化结果
      const finalErrors = ResultPostProcessor.process(ruleResults, llmErrors);

      const parsedOut = AgentResponseSchema.safeParse({ result: finalErrors, rawOutput });
      if (!parsedOut.success) {
        logger.warn('BasicErrorAgent.output_invalid', { zod: parsedOut.error.flatten?.() ?? String(parsedOut.error) });
        return { result: [], error: 'BasicErrorAgent.invalid_output', rawOutput } as AgentResponseOutput;
      }
      return parsedOut.data as AgentResponseOutput;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('BasicErrorAgent.invoke.error', { error: errorMessage });
      return { 
        result: [],
        error: errorMessage,
        rawOutput: ''
      } as AgentResponseOutput;
    }
  }
}

