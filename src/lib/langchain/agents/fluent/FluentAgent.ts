import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';

// 定义 FluentAgent 的输入结构
const FluentAgentInputSchema = z.object({
  text: z.string(),
  previous: z
    .object({
      issuesJson: z.string().optional(),
      patchedText: z.string().optional(),
      runIndex: z.number().optional(),
    })
    .optional(),
});

type FluentAgentInput = z.infer<typeof FluentAgentInputSchema>;

// FluentAgent 的 Prompt 模板（ChatPromptTemplate）
const FLUENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
你是中文“表达流畅性/可读性”优化专家，仅在不改变原意前提下提出最小编辑的替换建议。

一、检测范围（仅限 fluency）
1) 语义通顺：表达不自然、语序不佳、逻辑不顺。
2) 搭配/用词：搭配不当、措辞欠妥（不涉及错别字）。
3) 重复与冗余：在不改变原意下适度精简。
4) 更清晰的等价表达：更地道/清晰但不改变语义。

二、明确排除
- 拼写/标点/基础语法错误；需要上下文知识的含义改写；风格化主观改写。

三、输出格式（仅输出 JSON 数组）
- 严禁任何额外文字或 markdown；输出必须以 "[" 开头、以 "]" 结尾；无建议输出 []。
- 每个对象字段：
  - "type": "fluency"
  - "text": 原文片段（original.slice(start,end)）
  - "start": number（UTF-16 下标）
  - "end": number（end > start）
  - "suggestion": string（若为删除冗余则为 ""）
  - "explanation": string（客观说明，避免主观化）
  - "quote": 与 "text" 完全一致
  - "confidence": 0~1（把握高时再给）

四、索引与编辑原则
- 原则：original.slice(start,end) === text；不产生空区间“纯插入”。
- 如需“插入”，选用与插入点相邻的最小替换片段，使替换后等价于插入。
- 最小编辑；不大段重写；去重不重叠；≤200；不确定不输出。
`.trim()
  ],
  [
    'human',
    `
请在以下文本中检测流畅性问题，仅输出 JSON 数组：
{text}

若提供上一轮信息，请参考且保持与给定文本的索引一致：
- 上一轮问题（JSON）：{prevIssues}
- 已修复文本（仅参考）：{patchedText}
- 迭代编号：{runIndex}
`.trim()
  ],
]);

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
      const messages = await FLUENT_PROMPT.formatMessages({
        text: input.text,
        prevIssues: input.previous?.issuesJson ?? '',
        patchedText: input.previous?.patchedText ?? '',
        runIndex: String(input.previous?.runIndex ?? ''),
      } as any);
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
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
