import { z } from 'zod';
import { AgentResponse } from '@/types/agent';
import type { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { extractJsonArrayFromContent } from '@/lib/langchain/utils/llm-output';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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

const REVIEW_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `
你是严格的中文文本“错误审阅/裁决”专家。请对每条候选错误给出 accept/reject/modify 判决。

一、核心原则与约束
1) 覆盖性：必须对每个输入候选（按 id）都产出一条裁决，禁止新增或遗漏。
2) 输出格式：仅输出 JSON 数组，禁止任何额外文字/markdown。输出必须以 "[" 开头、以 "]" 结尾；若 candidates 为空则输出 []。
3) 裁决范围：对客观基础错误（拼写/标点/语法）做正向裁决；对主观风格化改写通常 reject；对不改变原意的 fluency 优化可酌情 accept/modify。
4) 最小编辑：接受的修改应尽可能小，不改变原意。
5) 索引合法性：若候选索引非法或无法在原文定位，请 reject。

二、输出字段
- id: string (与输入候选一致)
- status: "accept" | "reject" | "modify"
- start?: number (仅在 modify 且需调整 span 时提供)
- end?: number (同上，且 end > start)
- suggestion?: string (在 accept/modify 时可提供更准确的建议)
- explanation?: string (简要客观说明)
- confidence?: number (0~1，确定性高时提供)

三、判决指引
- accept: 候选客观正确，且 span/suggestion 合理。
- modify: 候选大体正确，但需微调 span 或 suggestion。给出必要的 start/end/suggestion 字段。
- reject: 不确定、无法定位、超出范围、或属于不必要的主观风格改写。
`.trim()
  ],
  [
    'human',
    `
原文：
{text}

候选列表（JSON）：
{candidates}

请对以上所有候选逐一裁决，仅输出 JSON 数组：
`.trim()
  ],
]);

export class ReviewerAgent {
  async call(input: ReviewerInput, signal?: AbortSignal): Promise<AgentResponse & { decisions?: z.infer<typeof ReviewDecisionSchema>[] }> {
    const parsed = ReviewerInputSchema.safeParse(input);
    if (!parsed.success) {
      return { result: [], error: 'ReviewerAgent.invalid_input' };
    }

    const llm = getLLM();
    try {
      const messages = await REVIEW_PROMPT.formatMessages({
        text: input.text,
        candidates: JSON.stringify(input.candidates, null, 2),
      });
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(messages as any, { signal: innerSignal } as any),
        { operationName: 'ReviewerAgent.llm', timeoutMs: Math.max(5000, Math.floor(config.langchain.analyzeTimeoutMs * 0.8)), parentSignal: signal }
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
