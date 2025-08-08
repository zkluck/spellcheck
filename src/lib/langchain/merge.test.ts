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
    type: partial.type ?? 'grammar',
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

  it('resolves overlaps by keeping shorter (more specific) range', () => {
    const a = e({ id: 'a', start: 0, end: 4, text: '今天天气' }); // wider range
    const b = e({ id: 'b', start: 0, end: 2, text: '今天', type: 'spelling' }); // shorter range
    const res = mergeErrors(text, [[a], [b]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('b'); // Should keep the shorter one
  });

  it('handles partial overlaps correctly', () => {
    const a = e({ id: 'a', start: 0, end: 4, text: '今天天气' });
    const b = e({ id: 'b', start: 2, end: 6, text: '天气很好' });
    // Overlap: '天气'. Keeps the one that starts first if lengths are equal.
    const res = mergeErrors(text, [[a], [b]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('a');
  });

  it('prefers higher priority type on same range', () => {
    const grammar = e({ id: 'grammar', start: 0, end: 2, text: '今天', type: 'grammar' });
    const spelling = e({ id: 'spelling', start: 0, end: 2, text: '今天', type: 'spelling' });
    const res = mergeErrors(text, [[grammar], [spelling]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('spelling'); // Spelling has higher priority
  });

  it('prefers longer explanation on same priority', () => {
    const a = e({ id: 'a', start: 0, end: 2, text: '今天', type: 'grammar', explanation: 'short' });
    const b = e({ id: 'b', start: 0, end: 2, text: '今天', type: 'grammar', explanation: 'a much longer explanation' });
    const res = mergeErrors(text, [[a], [b]]);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('b');
  });

  it('handles complex mix of overlaps and duplicates', () => {
    const errors = [
      // Group 1: Overlap + Priority
      e({ id: 'g1', start: 0, end: 4, text: '今天天气', type: 'grammar' }),
      e({ id: 's1', start: 0, end: 2, text: '今天', type: 'spelling' }), // Should be chosen over g1

      // Group 2: Identical duplicate
      e({ id: 'p1', start: 5, end: 7, text: '很好', type: 'punctuation' }),
      e({ id: 'p2', start: 5, end: 7, text: '很好', type: 'punctuation' }), // Duplicate of p1

      // Group 3: Non-overlapping
      e({ id: 'f1', start: 10, end: 12, text: '公园', type: 'fluency' }),

      // Group 4: Partial overlap with Group 3, but starts later
      e({ id: 'g2', start: 11, end: 14, text: '园散步' }), // Overlaps with f1
    ];
    const res = mergeErrors(text, [errors]);
    expect(res.length).toBe(3);
    expect(res.map(item => item.id).sort()).toEqual(['f1', 'p1', 's1'].sort());
    
    const chosenS1 = res.find(item => item.id === 's1');
    expect(chosenS1).toBeDefined();

    const chosenP1 = res.find(item => item.id === 'p1');
    expect(chosenP1).toBeDefined();

    // f1 and g2 overlap. f1 is shorter, so it should be chosen.
    const chosenF1 = res.find(item => item.id === 'f1');
    expect(chosenF1).toBeDefined();
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
