import { z } from 'zod';
import { AgentResponse } from '@/types/agent';
import type { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { extractJsonArrayFromContent } from '@/lib/langchain/utils/llm-output';
import { PromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

// 输入：原文 + 候选列表（来自各 Agent 的检测结果）
const ReviewerInputSchema = z.object({
  text: z.string(),
  candidates: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      suggestion: z.string(),
      type: z.enum(['spelling', 'punctuation', 'grammar', 'fluency']),
      explanation: z.string().optional(),
    })
  ),
});

export type ReviewerInput = z.infer<typeof ReviewerInputSchema>;

// 模型输出：对每条候选做判决
// status: accept(接受)
//         reject(拒绝)
//         modify(接受但需修改span或建议)
const ReviewDecisionSchema = z.object({
  id: z.string(),
  status: z.enum(['accept', 'reject', 'modify']),
  // 当 modify 时，可返回新的 span/suggestion/explanation
  start: z.number().optional(),
  end: z.number().optional(),
  suggestion: z.string().optional(),
  explanation: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).superRefine((val, ctx) => {
  // 若同时提供 start/end，则必须合法：end > start 且二者均为有限数
  if (typeof val.start === 'number' && typeof val.end === 'number') {
    if (!(Number.isFinite(val.start) && Number.isFinite(val.end) && val.end > val.start && val.start >= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'invalid span: require 0<=start<end' });
    }
  }
});

const REVIEW_PROMPT = new PromptTemplate({
  inputVariables: ['text', 'candidates'],
  template: `你是一位严格的中文文本错误审阅与校对专家。你将收到一段原文和若干“候选错误”，请你逐条审阅并给出判决。

请遵循：
- 仅在“确定有错误”或“有显著可读性提升”的情况下接受（accept）或修改（modify）；否则拒绝（reject）。
- 优先采用最小编辑原则，避免过度改写。
- 起止索引基于 JavaScript 字符串下标，且 [start, end) 子串必须与 text 字段完全一致。
- 仅输出 JSON 数组，每个元素包含：id, status, 以及在 modify 时可选的 start/end/suggestion/explanation/confidence。
 - 不要新增候选项；仅对给定 id 做判决。如果无法定位或索引不合法，请直接 reject。
 - 若选择 modify，并提供 start/end，则它们必须合法且对应的 [start, end) 子串来自原文；否则请 reject。

原文：
{text}

候选列表（JSON）：
{candidates}

示例：
输入候选：[{{"id":"a","text":"利害","start":6,"end":8,"suggestion":"厉害","type":"spelling"}}]
输出：
[
  {{"id":"a","status":"accept","confidence":0.9}}
]
`
});

export class ReviewerAgent {
  async call(input: ReviewerInput): Promise<AgentResponse & { decisions?: z.infer<typeof ReviewDecisionSchema>[] }> {
    const parsed = ReviewerInputSchema.safeParse(input);
    if (!parsed.success) {
      return { result: [], error: 'ReviewerAgent.invalid_input' };
    }

    const llm = getLLM();
    try {
      const prompt = await REVIEW_PROMPT.format({
        text: input.text,
        candidates: JSON.stringify(input.candidates, null, 2),
      });
      const response = await guardLLMInvoke(
        (signal) => llm.invoke(prompt as unknown as string, { signal } as any),
        { operationName: 'ReviewerAgent.llm', timeoutMs: Math.max(5000, Math.floor(config.langchain.analyzeTimeoutMs * 0.8)) }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const arr = extractJsonArrayFromContent(response.content);

      // 解析成 decisions
      const decisions: z.infer<typeof ReviewDecisionSchema>[] = [];
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
          metadata: { reviewer: { status: d.status, confidence: d.confidence } },
        } as ErrorItem);
      }

      return { result: refined, rawOutput, error: undefined, ...(decisions.length ? { decisions } : {}) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('ReviewerAgent.invoke.error', { error: msg });
      return { result: [], error: msg };
    }
  }
}
