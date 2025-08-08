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
 * 基于区间与文本内容去重（跨类型去重），并按优先级选择最佳项
 */
function dedupe(items: ErrorItem[]): ErrorItem[] {
  const groups = new Map<string, ErrorItem[]>();
  for (const e of items) {
    const key = `${e.start}:${e.end}:${e.text}`; // 不含 type，跨类型聚合
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const pickBest = (arr: ErrorItem[]): ErrorItem => {
    // 统一优先级：与 resolveOverlaps 中保持一致（数值越大优先级越高）
    const TYPE_PRIORITY: Record<ErrorItem['type'], number> = {
      spelling: 4,
      punctuation: 3,
      grammar: 2,
      fluency: 1,
    };
    const prio = (t: ErrorItem['type']): number => TYPE_PRIORITY[t] ?? 0;
    const explLen = (e: ErrorItem) => (e.explanation?.trim().length ?? 0);
    // 选择：类型优先级 > explanation 长度 > 原顺序
    return arr.reduce((best, cur) => {
      if (!best) return cur;
      const pBest = prio(best.type);
      const pCur = prio(cur.type);
      if (pCur !== pBest) return pCur > pBest ? cur : best;
      const eBest = explLen(best);
      const eCur = explLen(cur);
      if (eCur !== eBest) return eCur > eBest ? cur : best;
      return best; // 保持稳定性
    });
  };

  const out: ErrorItem[] = [];
  // 使用 forEach 以避免对 Map 的迭代要求 ES2015 downlevelIteration
  groups.forEach((arr) => {
    out.push(pickBest(arr));
  });
  return out;
}

/**
 * 解决重叠冲突：优先保留更精细（更短、更贴近）的项；
 * 若长度相同：按信息质量（explanation 长度）再按类型优先级。
 */
function resolveOverlaps(sorted: ErrorItem[]): ErrorItem[] {
  if (sorted.length === 0) return [];
  const prio = (t: ErrorItem['type']): number => {
    switch (t) {
      case 'spelling':
        return 4;
      case 'punctuation':
        return 3;
      case 'grammar':
        return 2;
      case 'fluency':
        return 1;
      default:
        return 0;
    }
  };
  const explLen = (e: ErrorItem) => (e.explanation?.trim().length ?? 0);

  const res: ErrorItem[] = [];
  let last = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const cur = { ...sorted[i] };
    if (cur.start < last.end) {
      const lastLen = last.end - last.start;
      const curLen = cur.end - cur.start;
      if (curLen !== lastLen) {
        // 保留更短的（更精细）
        last = curLen < lastLen ? cur : last;
      } else {
        const eBest = explLen(last);
        const eCur = explLen(cur);
        if (eCur !== eBest) {
          last = eCur > eBest ? cur : last;
        } else {
          const pBest = prio(last.type);
          const pCur = prio(cur.type);
          if (pCur !== pBest) {
            last = pCur > pBest ? cur : last;
          } else {
            // 仍无法判定，保持先到者（稳定性）
          }
        }
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
