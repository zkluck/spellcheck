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
  template: `你是一位严格的中文文本“错误审阅/裁决”专家。你将收到一段原文和若干“候选错误”，请逐条给出判决：accept（接受）、reject（拒绝）、modify（接受但需修改 span 或建议）。

一、范围与原则
1) 对客观、可验证的基础错误做正向裁决；对风格优化/表达润色等主观改写通常拒绝（reject）。若候选的 type 为 "fluency"，且在不改变原意的前提下能显著提升可读性，可接受（accept）或酌情 modify。
2) 最小编辑原则：若接受，修改应尽可能小，不改变原意，不做大段改写。
3) 不新增候选：只能对给定 id 做判决，禁止引入新项。

二、索引与合法性
1) 所有起止索引均基于 JavaScript 字符串下标（UTF-16），使用原文进行验证。
2) 若无法确保索引合法（end > start 且在原文范围内）或无法在原文定位到候选文本，请直接 reject。
3) 若选择 modify，并提供 start/end，它们必须使原文 slice(start, end) 与最终决定的文本相匹配（由系统据此回填 text）；否则请 reject。

三、输出格式（仅输出 JSON 数组，不要任何额外文字）
每个元素：
- id: string（与输入候选一致）
- status: "accept" | "reject" | "modify"
- start?: number（仅在 modify 需要调整 span 时提供）
- end?: number（仅在 modify 需要调整 span 时提供）
- suggestion?: string（在 accept/modify 时允许给出更准确的建议）
- explanation?: string（简要客观说明）
- confidence?: number（0~1，确定性高时再提供）

四、判决指引
- accept：确定该候选为客观错误，且其 span 与建议合理。
- modify：候选大体正确，但需要微调 span 或 suggestion 才精确；给出 start/end/suggestion 中必要的字段。
- reject：不确定、无法定位、超出“基础错误”范围、或属于风格/表达提升。

原文：
{text}

候选列表（JSON）：
{candidates}

示例 1（接受）：
输入候选：[{{"id":"a","text":"利害","start":6,"end":8,"suggestion":"厉害","type":"spelling"}}]
输出：
[
  {{"id":"a","status":"accept","confidence":0.9}}
]

示例 2（修改 span）：
原文："今天下雨了,我没带伞。"（半角逗号应为全角）
候选：[{{"id":"b","text":",","start":5,"end":6,"suggestion":"，","type":"punctuation"}}]
输出：
[
  {{"id":"b","status":"accept","confidence":0.9}}
]

示例 3（拒绝：风格/流畅度类）：
候选：[{{"id":"c","text":"非常","start":2,"end":4,"suggestion":"很","type":"fluency"}}]
输出：
[
  {{"id":"c","status":"reject","explanation":"风格化改写，非客观错误"}}
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
