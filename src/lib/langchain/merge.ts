import { ErrorItem } from '@/types/error';

/**
 * 扁平化 + 过滤无效项
 */
function flattenAndValidate(text: string, groups: ErrorItem[][]): ErrorItem[] {
  const max = text.length;
  const all = groups.flat().filter((e) => {
    const ok =
      e &&
      typeof e.start === 'number' &&
      typeof e.end === 'number' &&
      e.start >= 0 &&
      e.end > e.start &&
      e.end <= max &&
      typeof e.text === 'string' &&
      e.text.length > 0;
    return ok;
  });
  return all;
}

/**
 * 基于区间与文本内容去重
 */
function dedupe(items: ErrorItem[]): ErrorItem[] {
  const seen = new Set<string>();
  const out: ErrorItem[] = [];
  for (const e of items) {
    const key = `${e.start}:${e.end}:${e.text}:${e.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

/**
 * 解决重叠冲突：优先保留覆盖范围更大的项
 */
function resolveOverlaps(sorted: ErrorItem[]): ErrorItem[] {
  if (sorted.length === 0) return [];
  const res: ErrorItem[] = [];
  let last = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const cur = { ...sorted[i] };
    if (cur.start < last.end) {
      const lastLen = last.end - last.start;
      const curLen = cur.end - cur.start;
      if (curLen > lastLen) {
        last = cur;
      } else {
        // 保留 last（更长或相等）
      }
    } else {
      res.push(last);
      last = cur;
    }
  }
  res.push(last);
  return res;
}

/**
 * 合并来自不同 Agent 的错误列表，保证稳定顺序和去重/冲突解决
 */
export function mergeErrors(text: string, groups: ErrorItem[][]): ErrorItem[] {
  const all = flattenAndValidate(text, groups);
  if (all.length === 0) return [];

  // 先去重，再排序，再冲突处理
  const deduped = dedupe(all);
  deduped.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = resolveOverlaps(deduped);
  return merged;
}
