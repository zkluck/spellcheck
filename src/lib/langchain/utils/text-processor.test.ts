import { describe, it, expect } from 'vitest';
import { TextProcessor } from '@/lib/langchain/utils/text-processor';

describe('TextProcessor', () => {
  it('splitIntoSentences should split by Chinese punctuation', () => {
    const text = '你好。今天天气不错！要不要去？好啊；一起。';
    const sents = TextProcessor.splitIntoSentences(text);
    expect(sents.map(s => s.content)).toEqual(['你好。', '今天天气不错！', '要不要去？', '好啊；', '一起。']);
    expect(sents.every(s => s.type === 'sentence')).toBe(true);
  });

  it('splitIntoParagraphs should split by blank lines', () => {
    const text = '第一段\n内容\n\n第二段\n\n第三段';
    const paras = TextProcessor.splitIntoParagraphs(text);
    expect(paras.length).toBe(3);
    expect(paras[0].content).toContain('第一段');
    expect(paras.every(p => p.type === 'paragraph')).toBe(true);
  });

  it('findRepeatedWords should find repeated substrings', () => {
    const text = '我们我们要要学习，学学学知识。';
    const repeats = TextProcessor.findRepeatedWords(text);
    expect(repeats.length).toBeGreaterThan(0);
    // 至少包含“我们我们”或“要要”或“学学学”
    const words = repeats.map(r => r.word);
    expect(words.some(w => w.includes('我们')) || words.some(w => w.includes('要要')) || words.some(w => w.includes('学学'))).toBe(true);
  });

  it('extractContext should return before/after/fullSentence', () => {
    const text = '今天下雨了。我出门忘带伞。结果被淋湿了。';
    const start = text.indexOf('忘带伞');
    const end = start + '忘带伞'.length;
    const ctx = TextProcessor.extractContext(text, start, end, 2);
    expect(ctx.before.length).toBeGreaterThan(0);
    expect(ctx.after.length).toBeGreaterThan(0);
    expect(ctx.fullSentence.includes('我出门忘带伞。')).toBe(true);
  });
});
