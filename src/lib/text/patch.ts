import type { ErrorItem } from '@/types/error';

/**
 * 将一组 ErrorItem 以“最小替换”方式应用到文本，生成修复后的文本。
 *
 * 设计要点：
 * - 输入 ErrorItem 使用基于原始文本的 UTF-16 索引区间 [start, end)。
 * - 为避免因为先后替换造成的索引漂移，采用“累计偏移量”算法：
 *   当前实际替换位置 = 原始 start + 累计偏移量。
 * - 为避免重叠冲突，若发现与上一条（以原始坐标为基准）重叠，则跳过当前项。
 * - 为保证稳健性，在替换前校验当前片段是否大致匹配（宽松判断：仅长度与边界），
 *   若完全不匹配则跳过该项，避免破坏文本结构。
 */
export function applyErrorItems(text: string, items: ErrorItem[]): {
  patchedText: string;
  applied: number;
  skipped: number;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { patchedText: text, applied: 0, skipped: 0 };
  }

  // 以原始坐标排序，保证从左到右应用
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  let patched = text;
  let offsetDelta = 0; // 已累计的长度变化 = 已替换后的新文本 - 原文本 的增量
  let applied = 0;
  let skipped = 0;
  let lastEndOriginal = -1; // 记录上一条在“原始坐标系”下的 end，用于判定重叠

  for (const e of sorted) {
    // 跳过无效项与重叠项（以原始坐标为基准）
    if (e.start < 0 || e.end <= e.start || e.start < lastEndOriginal) {
      skipped++;
      continue;
    }

    const origLen = e.end - e.start;
    const replacement = typeof e.suggestion === 'string' ? e.suggestion : '';

    // 计算在“当前 patched 文本”中的实际替换起止位置
    const curStart = e.start + offsetDelta;
    const curEnd = curStart + origLen;

    // 边界检查：若越界则跳过
    if (curStart < 0 || curEnd > patched.length) {
      skipped++;
      continue;
    }

    const currentSlice = patched.slice(curStart, curEnd);

    // 宽松校验：长度一致即可；若强校验需完全等于 e.text，可改为 currentSlice === e.text
    if (currentSlice.length !== origLen) {
      skipped++;
      continue;
    }

    // 执行替换
    patched = patched.slice(0, curStart) + replacement + patched.slice(curEnd);

    // 更新累计偏移量与状态
    offsetDelta += replacement.length - origLen;
    lastEndOriginal = e.end;
    applied++;
  }

  return { patchedText: patched, applied, skipped };
}
