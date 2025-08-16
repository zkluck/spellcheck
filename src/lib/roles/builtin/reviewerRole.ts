import { Role, AnalysisInput, RoleContext, RoleFinal } from '@/lib/roles/types';
import { ReviewerAgent } from '@/lib/langchain/agents/reviewer/ReviewerAgent';
import type { ErrorItem } from '@/types/error';
import type { ReviewerInput } from '@/types/schemas';

function readNumber(envName: string, fallback?: number): number | undefined {
  const v = process.env[envName];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const reviewerRole: Role = {
  id: 'reviewer',
  name: '候选裁决审阅',
  description: '对候选逐一进行 accept/reject/modify 的严格裁决，输出通过裁决的最终项',
  capabilities: ['review'],
  defaultModel: {
    name: process.env.OPENAI_MODEL ?? 'Doubao-1.5-lite-32k',
    temperature: readNumber('OPENAI_TEMPERATURE', 0.2),
    maxTokens: readNumber('OPENAI_MAX_TOKENS', 1024),
    timeoutMs: readNumber('OPENAI_TIMEOUT_MS'),
    maxRetries: readNumber('OPENAI_MAX_RETRIES', 2),
  },
  async run(input: AnalysisInput, ctx: RoleContext): Promise<RoleFinal<{ items: ErrorItem[]; rawOutput?: string; error?: string; decisions?: any }>> {
    const modelName = (ctx.metadata as any)?.modelName as string | undefined;
    const agent = new ReviewerAgent({ modelName });

    const prevItems = (ctx.metadata as any)?.previousItems as ErrorItem[] | undefined;
    const text = input.text;

    const candidates: ReviewerInput['candidates'] = (prevItems ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      start: c.start,
      end: c.end,
      suggestion: c.suggestion,
      type: c.type as any,
      explanation: c.explanation ?? '',
    }));

    const res = await agent.call({ text, candidates }, ctx.signal as any);
    const items: ErrorItem[] = Array.isArray(res.result) ? res.result : [];

    return { type: 'final', data: { items, rawOutput: res.rawOutput, error: res.error, decisions: (res as any).decisions } };
  },
};
