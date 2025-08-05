import { describe, it, expect } from 'vitest';
import { mergeErrors } from '@/lib/langchain/merge';
import type { ErrorItem } from '@/types/error';

const text = '今天天气很好，我们一起去公园散步。后来又下雨了。';

function e(partial: Partial<ErrorItem>): ErrorItem {
  return {
    id: partial.id ?? 'id',
    start: partial.start ?? 0,
    end: partial.end ?? 1,
    text: partial.text ?? 'x',
    suggestion: partial.suggestion ?? 'x',
    type: partial.type ?? 'other',
    explanation: partial.explanation,
    metadata: partial.metadata,
  };
}

describe('mergeErrors', () => {
  it('returns empty when no errors', () => {
    expect(mergeErrors(text, [])).toEqual([]);
  });

  it('dedupes identical items', () => {
    const a = e({ id: 'a', start: 0, end: 2, text: '今天', type: 'grammar' });
    const res = mergeErrors(text, [[a, a]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('a');
  });

  it('resolves overlaps by keeping longer range', () => {
    const a = e({ id: 'a', start: 0, end: 2, text: '今天' });
    const b = e({ id: 'b', start: 0, end: 3, text: '今天天' });
    const res = mergeErrors(text, [[a], [b]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('b');
    expect(res[0].start).toBe(0);
    expect(res[0].end).toBe(3);
  });

  it('keeps order and merges non-overlapping', () => {
    const a = e({ id: 'a', start: 0, end: 2, text: '今天' });
    const b = e({ id: 'b', start: 5, end: 7, text: '很好' });
    const res = mergeErrors(text, [[a, b]]);
    expect(res.length).toBe(2);
    expect(res[0].id).toBe('a');
    expect(res[1].id).toBe('b');
  });
});
