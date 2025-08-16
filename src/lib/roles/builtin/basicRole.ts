import { Role, AnalysisInput, RoleContext, RoleFinal } from '@/lib/roles/types';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import type { ErrorItem } from '@/types/error';

function readNumber(envName: string, fallback?: number): number | undefined {
  const v = process.env[envName];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const basicRole: Role = {
  id: 'basic',
  name: '基础错误与流畅性检测',
  description: '检测拼写、标点、基础语法与流畅性问题（最小替换，不做主观改写）',
  capabilities: ['spelling', 'punctuation', 'grammar', 'fluency'],
  defaultModel: {
    name: process.env.OPENAI_MODEL ?? 'Doubao-1.5-lite-32k',
    temperature: readNumber('OPENAI_TEMPERATURE', 0.2),
    maxTokens: readNumber('OPENAI_MAX_TOKENS', 1024),
    timeoutMs: readNumber('OPENAI_TIMEOUT_MS'),
    maxRetries: readNumber('OPENAI_MAX_RETRIES', 2),
  },
  async run(input: AnalysisInput, ctx: RoleContext): Promise<RoleFinal<{ items: ErrorItem[]; rawOutput?: string; error?: string }>> {
    const modelName = (ctx.metadata as any)?.modelName as string | undefined;
    const agent = new BasicErrorAgent({ modelName });

    // 从 metadata 读取上一轮结果与运行序号
    const prevItems = (ctx.metadata as any)?.previousItems as ErrorItem[] | undefined;
    const runIndex = (ctx.metadata as any)?.runIndex as number | undefined;
    const enabledTypes = (ctx.metadata as any)?.enabledTypes as string[] | undefined;

    const previous = prevItems && prevItems.length > 0 ? { issuesJson: JSON.stringify(prevItems), runIndex } : { runIndex };

    const res = await agent.call({ text: input.text, previous }, ctx.signal as any);
    let items: ErrorItem[] = Array.isArray(res.result) ? res.result : [];

    if (Array.isArray(enabledTypes) && enabledTypes.length > 0) {
      const allowed = new Set(enabledTypes);
      items = items.filter((it) => allowed.has(it.type as any));
    }

    return { type: 'final', data: { items, rawOutput: res.rawOutput, error: res.error } };
  },
};
