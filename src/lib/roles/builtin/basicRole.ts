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
  name: '基础错误检测',
  description: '基础错误检测（spelling、punctuation、grammar 相关功能已移除）',
  capabilities: [],
  defaultModel: {
    name: process.env.OPENAI_MODEL ?? 'Doubao-1.5-lite-32k',
    temperature: readNumber('OPENAI_TEMPERATURE', 0.2),
    maxTokens: readNumber('OPENAI_MAX_TOKENS', 1024),
    timeoutMs: readNumber('OPENAI_TIMEOUT_MS'),
    maxRetries: readNumber('OPENAI_MAX_RETRIES', 2),
  },
  async run(input: AnalysisInput, ctx: RoleContext): Promise<RoleFinal<{ items: ErrorItem[]; rawOutput?: string; error?: string }>> {
    // 元数据仅保留与当前角色运行相关的必要字段
    const md = (ctx.metadata ?? {}) as Partial<{
      modelName: string;
      runIndex: number;
      enabledTypes: string[];
    }>;
    const modelName = md.modelName;
    const agent = new BasicErrorAgent({ modelName });

    const enabledTypes = md.enabledTypes;

    // 说明：ctx.signal 类型为 Node.js/DOM 的 AbortSignal，类型在不同运行时存在差异，
    // 这里保持 RoleContext.signal 为 any 仅用于传递与监听取消事件，不参与业务逻辑。
    const res = await agent.call({ text: input.text }, ctx.signal);
    let items: ErrorItem[] = Array.isArray(res.result) ? res.result : [];

    if (Array.isArray(enabledTypes) && enabledTypes.length > 0) {
      const allowed = new Set(enabledTypes);
      items = items.filter((it) => it.type !== undefined && allowed.has(it.type));
    }

    return { type: 'final', data: { items, rawOutput: res.rawOutput, error: res.error } };
  },
};
