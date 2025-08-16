import { AgentResponse } from '@/types/agent';
import type { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { extractJsonArrayFromContent } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';
import { ReviewerInputSchema, ReviewDecisionSchema } from '@/types/schemas';
import type { ReviewerInput, ReviewDecision } from '@/types/schemas';
import { AgentResponseSchema } from '@/types/schemas';

/**
 * ReviewerAgent 执行说明：
 * - 执行时机与是否启用由后端工作流配置 WORKFLOW_PIPELINE 决定，前端与 API 均不提供 reviewer 开关。
 * - 如工作流未包含 reviewer 节点，则不会运行本 Agent。
 */

// 输入与模型裁决 Schema 均从共享定义中导入

// 将包含 JSON 花括号的示例放到变量里，避免 ChatPromptTemplate 把花括号当占位符解析
const REVIEW_EXAMPLES = `
- 示例1: 接受 (accept)
  输入 candidates:
  [
    { "id": "a1", "type": "spelling", "start": 2, "end": 4, "suggestion": "高兴", "explanation": "错别字" }
  ]
  输出:
  [
    { "id": "a1", "status": "accept", "explanation": "客观错误，span 合理", "confidence": 0.95 }
  ]

- 示例2: 修改 (modify)（微调 span 与建议）
  输入 candidates:
  [
    { "id": "b2", "type": "punctuation", "start": 5, "end": 7, "suggestion": "！" }
  ]
  输出:
  [
    { "id": "b2", "status": "modify", "start": 5, "end": 6, "suggestion": "！", "explanation": "多余的一个感叹号" }
  ]

- 示例3: 拒绝 (reject)
  输入 candidates:
  [
    { "id": "c3", "type": "fluency", "start": 0, "end": 2, "suggestion": "更加地道" }
  ]
  输出:
  [
    { "id": "c3", "status": "reject", "explanation": "主观风格化或定位不确定" }
  ]

- 示例4: 空候选
  输入 candidates: []
  输出: []
`;

const REVIEW_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
<ROLE_AND_GOAL>
你是严格的中文文本“错误审阅/裁决”专家。你的唯一任务是对输入候选逐一给出 accept/reject/modify 的判决。
- 覆盖性：必须对每个候选（按 id）都产出一条裁决，禁止新增或遗漏。
- 范围：客观基础错误（拼写/标点/语法）优先正向裁决；主观风格化改写通常 reject；不改变原意的 fluency 优化可酌情 accept/modify。
</ROLE_AND_GOAL>

<OUTPUT_FORMAT>
你的唯一输出必须是一个 JSON 数组，即使 candidates 为空也输出 []。严禁任何额外文字或 Markdown。

每个 JSON 对象字段如下：
- id: string（与输入候选一致）
- status: "accept" | "reject" | "modify"
- start?: number（仅在 modify 且需调整 span 时提供）
- end?: number（同上，且 end > start）
- suggestion?: string（在 accept/modify 时可提供更准确的建议）
- explanation?: string（简要客观说明）
- confidence?: number（0~1，确定性高时提供）
</OUTPUT_FORMAT>

<RULES>
1. 索引合法：若候选索引非法或无法在原文定位，请 reject。
2. 最小编辑：接受或修改时尽可能小幅调整，不改变原意。
3. 一致性：不得新增不存在的 id，且不得遗漏任何输入候选。
4. 数量约束：输出数组长度必须与输入候选数一致（1:1 对齐）。
</RULES>

<EXAMPLES>
{examples}
</EXAMPLES>
`.trim()
  ],
  [
    'human',
    `
请严格按照上述 <OUTPUT_FORMAT> 和 <RULES> 对候选进行裁决。

<TEXT_TO_ANALYZE>
{text}
</TEXT_TO_ANALYZE>

<CANDIDATES>
{candidates}
</CANDIDATES>

仅输出 JSON 数组：
`.trim()
  ],
]);

export class ReviewerAgent {
  private modelName?: string;
  constructor(opts?: { modelName?: string }) {
    this.modelName = opts?.modelName;
  }
  async call(input: ReviewerInput, signal?: AbortSignal): Promise<AgentResponse & { decisions?: ReviewDecision[] }> {
    const parsed = ReviewerInputSchema.safeParse(input);
    if (!parsed.success) {
      return { result: [], error: 'ReviewerAgent.invalid_input' };
    }

    const llm = getLLM({ modelName: this.modelName });
    try {
      const messages = await REVIEW_PROMPT.formatMessages({
        text: input.text,
        candidates: JSON.stringify(input.candidates, null, 2),
        examples: REVIEW_EXAMPLES,
      });
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        { 
          operationName: 'ReviewerAgent.llm', 
          timeoutMs: Math.max(5000, Math.floor(config.langchain.analyzeTimeoutMs * 0.8)), 
          parentSignal: signal,
          logFields: {
            text: input.text,
            candidates: input.candidates,
          },
        }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const arr = extractJsonArrayFromContent(response.content);

      // 解析成 decisions
      const decisions: ReviewDecision[] = [];
      for (const it of arr) {
        const p = ReviewDecisionSchema.safeParse(it);
        if (p.success) decisions.push(p.data);
      }

      // 应用决策到候选，产出 refined items
      const index = new Map(input.candidates.map((c) => [c.id, c]));
      const refined: ErrorItem[] = [];
      for (const d of decisions) {
        const base = index.get(d.id);
        if (!base) continue;
        if (d.status === 'reject') continue;
        const start = d.start ?? base.start;
        const end = d.end ?? base.end;
        // 基本边界校验，确保索引合法并在原文范围内
        if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= input.text.length)) {
          // 索引不合法，丢弃该决策
          continue;
        }
        const suggestion = d.suggestion ?? base.suggestion;
        const explanation = d.explanation ?? base.explanation ?? '';
        refined.push({
          id: base.id,
          start,
          end,
          text: input.text.slice(start, end),
          suggestion,
          type: base.type,
          explanation,
          metadata: {
            reviewer: { status: d.status, confidence: d.confidence },
            confidence: typeof d.confidence === 'number' ? d.confidence : undefined,
            locate: 'exact',
          },
        } as ErrorItem);
      }

      // 根据配置执行过滤与裁剪
      const requireExact = config.langchain.agents.reviewer.requireExactIndex;
      const indexFiltered = requireExact
        ? refined.filter((e) => (e as any).metadata?.locate === 'exact')
        : refined;

      const minC = config.langchain.agents.reviewer.minConfidence;
      const confidenceFiltered = indexFiltered.filter((e) => {
        const m = (e as any).metadata;
        const c = typeof m?.confidence === 'number' ? m.confidence : (typeof m?.reviewer?.confidence === 'number' ? m.reviewer.confidence : undefined);
        return typeof c === 'number' && c >= minC;
      });

      const maxN = config.langchain.agents.reviewer.maxOutput;
      const finalItems = confidenceFiltered.slice(0, Math.max(0, maxN || 0));

      // 使用共享的 AgentResponseSchema 校验核心输出结构
      const core = { result: finalItems, rawOutput };
      const parsedOut = AgentResponseSchema.safeParse(core);
      if (!parsedOut.success) {
        logger.warn('ReviewerAgent.output_invalid', { zod: parsedOut.error.flatten?.() ?? String(parsedOut.error) });
        return { result: [], error: 'ReviewerAgent.invalid_output', rawOutput } as AgentResponse;
      }
      const validated = parsedOut.data as AgentResponse;
      return { ...validated, ...(decisions.length ? { decisions } : {}) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('ReviewerAgent.invoke.error', { error: msg });
      return { result: [], error: msg };
    }
  }
}
