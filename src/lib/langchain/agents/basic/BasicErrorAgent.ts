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

// BasicErrorAgent 的 Prompt 模板（ChatPromptTemplate）
const BASIC_ERROR_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
你是中文“基础错误”检测专家。只检测客观且可验证的错误：spelling/punctuation/grammar。

一、禁止越界与输出约束
- 严禁输出除 JSON 数组以外的任何字符（包括解释、前后缀、markdown 代码块）。
- 输出必须以 "[" 开头、以 "]" 结尾；若无错误，输出 []。
- 严禁风格优化/语气润色/主观改写/需要外部知识推断的修改。

二、字段与格式（仅 JSON 数组）
每个对象字段：
- "type": "spelling" | "punctuation" | "grammar"
- "text": 原文片段（必须等于 original.slice(start, end)）
- "start": number（UTF-16 下标）
- "end": number（end > start）
- "suggestion": string（**必须**提供具体修正建议，而不是在解释中说明。若为删除，则为空字符串 ""）
- "explanation": string（客观说明，避免主观措辞）
- "quote": 与 "text" 完全一致
- "confidence": 0~1（把握高时再给）

三、索引与编辑原则
- 必须满足 original.slice(start,end) === text；不跨越/发明上下文。
- 禁止空区间“纯插入”。如需“插入”，使用与插入点相邻的最小可替换片段，用 suggestion 达到等价插入。
- 最小编辑；去重且不重叠；数量≤200；不确定不报错。

四、示例（仅参考，不要在输出中包含说明文本）
- 删除冗余：text 为冗余片段，suggestion为 ""。
- 等价插入标点：选择与插入点相邻最小片段，使替换后效果等价于“插入”。
- 引号成对修正：修正配对错误，不改变其它内容。
- 量词错误：将明显错误量词更正为客观正确用法。
`.trim()
  ],
  [
    'human',
    `
请在以下文本中检测基础错误（仅输出 JSON 数组）：
{text}

若提供上一轮信息，请参考但不要改变索引基准：
- 上一轮问题（JSON）：{prevIssues}
- 已修复文本（仅参考）：{patchedText}
- 迭代编号：{runIndex}
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
            });
            allErrors.push(...processedErrors);
          }
        }
      }

      const parsedOut = AgentResponseSchema.safeParse({ result: allErrors, rawOutput });
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
