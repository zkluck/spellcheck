/**
 * 强类型的错误来源工具集。
 * 目标：
 * - 统一 agent -> source 的归一化逻辑
 * - 为错误项注入 metadata.sources（string[]），用于来源徽章展示与内部统计
 * - 从错误项提取 sources 列表
 *
 * 注意：
 * - ErrorItem.metadata 在运行时是一个 Record<string, unknown> 的动态对象，后端版本会演进；
 *   因此我们避免使用 any，通过类型守卫安全读写。
 */
import type { ErrorItem } from '@/types/error';

// 支持的来源标签类型
export type SourceTag = 'basic' | 'fluent' | 'reviewer';

/**
 * 将后端的 agent 字段规范化为固定的来源标签。
 * 未识别时返回 null，用于保持向后兼容。
 */
export function normalizeAgent(name?: string | null): SourceTag | null {
  if (!name) return null;
  const v = String(name).trim().toLowerCase();
  if (v === 'basic') return 'basic';
  if (v === 'fluent') return 'fluent';
  if (v === 'reviewer') return 'reviewer';
  return null;
}

/**
 * 类型守卫：判断值是否为字符串数组
 */
function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((x) => typeof x === 'string');
}

/**
 * 安全读取对象的某个键（避免 any）。
 */
function readKey<T>(obj: unknown, key: string): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  return rec[key] as T | undefined;
}

/**
 * 提取错误项中的来源列表，按小写去重后返回。
 * 优先 metadata.sources，其次 metadata.source，再次顶层非标准字段 source（为兼容历史数据）。
 */
export function getSources(error: ErrorItem): string[] {
  const meta = (error as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
  const s1 = readKey<unknown>(meta, 'sources');
  if (isStringArray(s1)) {
    return Array.from(new Set(s1.map((x) => x.toLowerCase())));
  }
  const s2 = readKey<unknown>(meta, 'source');
  if (typeof s2 === 'string' && s2.trim()) {
    return [s2.trim().toLowerCase()];
  }
  // 兼容：部分历史实现把 source 写在顶层（非标准字段）
  const topSource = readKey<unknown>(error as unknown as Record<string, unknown>, 'source');
  if (typeof topSource === 'string' && topSource.trim()) {
    return [topSource.trim().toLowerCase()];
  }
  return [];
}

/**
 * 为错误数组注入来源标签（metadata.sources）。
 * - 保留已有 metadata，其它字段不变
 * - 对已有来源去重并小写规范化
 */
export function attachSources(items: ErrorItem[], agent?: string | null): ErrorItem[] {
  const src = normalizeAgent(agent ?? null);
  if (!src) return items.slice();
  return items.map((e) => {
    const metaIn = (e as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
    const existing = getSources(e);
    const merged = Array.from(new Set([...existing, src]));
    const metaOut: Record<string, unknown> = { ...metaIn, sources: merged };
    const next: ErrorItem = { ...e, metadata: metaOut };
    return next;
  });
}
