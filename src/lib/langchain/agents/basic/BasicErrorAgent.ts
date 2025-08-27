import { BaseAgent } from '../base/BaseAgent';
import { AgentInput, AgentResponseOutput } from '@/types/schemas';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { ErrorItem } from '@/types/error';
import { AgentResponseSchema } from '@/types/schemas';
import { ruleEngine } from '@/lib/rules/engine';
import { ResultPostProcessor } from '@/lib/rules/postprocessor';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';

// 将包含 JSON 花括号的示例放到变量里，避免 ChatPromptTemplate 把花括号当占位符解析
const BASIC_ERROR_EXAMPLES = `
- 示例1: 检测示例
  输入: "测试文本"
  输出:
  [
    {
      // type 字段可选
      "text": "错误片段",
      "start": 0,
      "end": 2,
      "suggestion": "修正建议",
      "explanation": "错误说明",
      "quote": "错误片段",
      "confidence": 0.95
    }
  ]
`;

// 简化的 Prompt
const COMBINED_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
<ROLE_AND_GOAL>
你是一个专业的中文文本校对专家。请检测文本中的错误和问题。

**质量要求：**
- 高置信度：只输出确定性高的错误，避免主观判断
- 最小干预：保持原文风格，不进行大幅改写
- 精确定位：确保索引位置完全准确
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
输出格式：纯 JSON 数组，无其他文字。每个错误对象包含：
- "type": 错误类型（可选）
- "text": 原文错误片段（必须与索引位置完全匹配）
- "start": 起始索引位置（UTF-16）
- "end": 结束索引位置（UTF-16）
- "suggestion": 修正建议（删除时为空字符串）
- "explanation": 错误说明（简洁明确）
- "quote": 与text字段相同
- "confidence": 置信度（0.0-1.0，高置信度才输出）
</OUTPUT_FORMAT>

<DETECTION_STRATEGY>
检测策略：识别文本中的各种错误和问题，提供准确的定位和建议。
</DETECTION_STRATEGY>

<EXAMPLES>
【基础错误示例】
{basicExamples}
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
`.trim()
  ],
]);

/**
 * BasicErrorAgent 负责检测基础的、客观的错误：拼写、标点、基础语法
 */
export class BasicErrorAgent extends BaseAgent<AgentInput> {
  private modelName?: string;
  constructor(opts?: { modelName?: string }) {
    super('BasicErrorAgent');
    this.modelName = opts?.modelName;
  }

  async call(input: AgentInput, signal?: AbortSignal): Promise<AgentResponseOutput> {
    const llm = getLLM({ modelName: this.modelName });

    try {
      // 首先使用规则引擎检测
      const ruleResults = config.detection.ruleEngine.enabled 
        ? ruleEngine.detect(input.text)
        : [];

      // 然后使用 LLM 检测
      const messages = await COMBINED_PROMPT.formatMessages({
        text: input.text,
        basicExamples: BASIC_ERROR_EXAMPLES,
      } as any);
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        {
          operationName: 'BasicErrorAgent.combined.llm',
          parentSignal: signal,
          logFields: {
            text: input.text,
          },
        }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      // 统一解析 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      
      // 简化处理，无类型区分
      const llmItems: ErrorItem[] = [];
      for (const rawItem of rawItems) {
        if (rawItem && typeof rawItem === 'object') {
          const processed = toErrorItems([rawItem], {
            originalText: input.text,
            allowLocateByTextUnique: config.langchain.agents.basic.allowLocateFallback,
          });
          llmItems.push(...processed);
        }
      }

      // 使用后处理器合并和优化结果
      const finalErrors = ResultPostProcessor.process(ruleResults, llmItems);

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

