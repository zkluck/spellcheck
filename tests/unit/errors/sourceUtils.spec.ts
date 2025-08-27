import { describe, it, expect } from 'vitest';
import type { ErrorItem } from '@/types/error';
import {
  normalizeAgent,
  getSources,
  attachSources,
} from '@/lib/errors/sourceUtils';

function makeErr(overrides?: Partial<ErrorItem>): ErrorItem {
  return {
    id: overrides?.id ?? 'e1',
    start: overrides?.start ?? 0,
    end: overrides?.end ?? 1,
    text: overrides?.text ?? 'a',
    suggestion: overrides?.suggestion ?? '',
    explanation: overrides?.explanation,
    metadata: overrides?.metadata as Record<string, unknown> | undefined,
  } as ErrorItem;
}

describe('sourceUtils.normalizeAgent', () => {
  it('maps known agents', () => {
    expect(normalizeAgent('basic')).toBe('basic');
    expect(normalizeAgent('BASIC')).toBe('basic');
    // fluent 类型已移除，现在应该返回 null
    expect(normalizeAgent('fluent')).toBeNull();
    expect(normalizeAgent('reviewer')).toBe('reviewer');
  });
  it('returns null for unknown', () => {
    expect(normalizeAgent('other')).toBeNull();
    expect(normalizeAgent(undefined)).toBeNull();
    expect(normalizeAgent(null)).toBeNull();
  });
});

describe('sourceUtils.getSources', () => {
  it('returns [] when no source metadata', () => {
    const e = makeErr();
    expect(getSources(e)).toEqual([]);
  });
  it('reads metadata.sources and lowercases + dedup', () => {
    const e = makeErr({ metadata: { sources: ['Basic', 'basic', 'Reviewer'] } as unknown as Record<string, unknown> });
    expect(getSources(e)).toEqual(['basic', 'reviewer']);
  });
  it('reads metadata.source string fallback', () => {
    const e = makeErr({
      metadata: { source: 'Reviewer' } as unknown as Record<string, unknown>,
    });
    expect(getSources(e)).toEqual(['reviewer']);
  });
  it('reads top-level source fallback for legacy data', () => {
    const e = makeErr({} as Partial<ErrorItem>) as ErrorItem;
    (e as unknown as Record<string, unknown>)['source'] = 'BASIC';
    expect(getSources(e)).toEqual(['basic']);
  });
});

describe('sourceUtils.attachSources', () => {
  it('returns shallow-copied list when agent is unknown/null', () => {
    const e = makeErr();
    const arr = [e];
    const out = attachSources(arr, 'unknown');
    expect(out).not.toBe(arr); // new array
    expect(out[0]).toBe(e); // same item
  });
  it('injects reviewer to empty metadata', () => {
    const e = makeErr();
    const [out] = attachSources([e], 'reviewer');
    expect(getSources(out)).toEqual(['reviewer']);
  });
  it('merges with existing sources and dedups/lowercases', () => {
    const e = makeErr({
      metadata: { sources: ['Basic'] } as unknown as Record<string, unknown>,
    });
    const [out] = attachSources([e], 'Reviewer');
    expect(getSources(out)).toEqual(['basic', 'reviewer']);
  });
  it('preserves other metadata fields', () => {
    const e = makeErr({
      metadata: { foo: 1 } as unknown as Record<string, unknown>,
    });
    const [out] = attachSources([e], 'basic');
    const meta =
      (out as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
    expect(meta['foo']).toBe(1);
  });
});
