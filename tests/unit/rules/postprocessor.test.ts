import { describe, it, expect } from 'vitest';
import { ResultPostProcessor } from '@/lib/rules/postprocessor';
import { ErrorItem } from '@/types/error';

describe('ResultPostProcessor', () => {
  const createErrorItem = (
    id: string,
    start: number,
    end: number,
    type: 'spelling' | 'grammar' | 'punctuation' | 'fluency',
    confidence: number,
    source: string = 'llm'
  ): ErrorItem => {
    // 使用更现实的文本示例
    const textMap: Record<string, string> = {
      spelling: '错字',
      grammar: '的时候',
      punctuation: '。。',
      fluency: '很好'
    };
    
    const suggestionMap: Record<string, string> = {
      spelling: '错误',
      grammar: '时候',
      punctuation: '。',
      fluency: '良好'
    };
    
    return {
      id,
      start,
      end,
      type,
      text: textMap[type] || `text_${id}`,
      suggestion: suggestionMap[type] || `suggestion_${id}`,
      metadata: {
        confidence,
        source,
        description: `Description for ${id}`
      }
    };
  }

  describe('置信度阈值过滤', () => {
    it('应该过滤低置信度的结果', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        createErrorItem('1', 0, 4, 'spelling', 0.9),
        createErrorItem('2', 5, 9, 'spelling', 0.7), // 低于默认阈值 0.85
        createErrorItem('3', 10, 14, 'grammar', 0.8), // 高于默认阈值 0.75
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(2);
      expect(results.find(r => r.id === '2')).toBeUndefined();
      expect(results.find(r => r.id === '1')).toBeDefined();
      expect(results.find(r => r.id === '3')).toBeDefined();
    });
  });

  describe('冲突解决', () => {
    it('应该优先选择规则引擎结果', () => {
      const ruleResults: ErrorItem[] = [
        createErrorItem('rule1', 0, 4, 'spelling', 0.9, 'rule_engine')
      ];
      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 4, 'spelling', 0.95, 'llm')
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('rule1');
      expect(results[0].metadata?.source).toBe('rule_engine');
    });

    it('应该在无规则引擎结果时选择高置信度LLM结果', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 4, 'spelling', 0.9, 'llm'),
        createErrorItem('llm2', 0, 4, 'spelling', 0.95, 'llm')
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('llm2');
    });
  });

  describe('逻辑验证', () => {
    it('应该过滤无意义的替换', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 0, 4, 'spelling', 0.9), text: 'test', suggestion: 'test' }, // 相同文本
        createErrorItem('2', 5, 9, 'spelling', 0.9), // 正常替换
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('应该过滤无效的索引范围', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 5, 5, 'spelling', 0.9) }, // start >= end
        { ...createErrorItem('2', 10, 5, 'spelling', 0.9) }, // start > end
        createErrorItem('3', 0, 4, 'spelling', 0.9), // 正常范围
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('3');
    });
  });

  describe('类型特定验证', () => {
    it('应该对拼写错误进行严格验证', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 0, 4, 'spelling', 0.85), text: '的', suggestion: '地' }, // 常见词汇，需要高置信度
        { ...createErrorItem('2', 5, 9, 'spelling', 0.95), text: '的', suggestion: '地' }, // 高置信度，应该通过
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('应该验证标点符号长度变化', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 0, 2, 'punctuation', 0.95), text: '！！', suggestion: '！' }, // 合理变化
        { ...createErrorItem('2', 3, 4, 'punctuation', 0.95), text: '。', suggestion: '。这是一个很长的替换' }, // 过大变化
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });

    it('应该验证语法修改的词汇数量变化', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 0, 6, 'grammar', 0.8), text: '一个人', suggestion: '一位人' }, // 合理变化
        { ...createErrorItem('2', 7, 10, 'grammar', 0.8), text: '走了', suggestion: '走了很远很远的路程到了很远的地方' }, // 过大变化
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });
  });

  describe('综合测试', () => {
    it('应该正确处理复杂的混合场景', () => {
      const ruleResults: ErrorItem[] = [
        createErrorItem('rule1', 0, 2, 'punctuation', 0.95, 'rule_engine'),
        createErrorItem('rule2', 10, 12, 'spelling', 0.9, 'rule_engine'),
      ];
      
      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 2, 'punctuation', 0.98, 'llm'), // 与rule1冲突
        createErrorItem('llm2', 5, 8, 'grammar', 0.8, 'llm'), // 独立结果
        createErrorItem('llm3', 15, 18, 'fluency', 0.6, 'llm'), // 低置信度
        { ...createErrorItem('llm4', 20, 24, 'spelling', 0.9, 'llm'), text: 'same', suggestion: 'same' }, // 无意义替换
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults, ['punctuation', 'spelling', 'grammar']);
      
      expect(results).toHaveLength(3);
      
      // 规则引擎结果应该被保留
      expect(results.find(r => r.id === 'rule2')).toBeDefined();
      
      // 独立的LLM结果应该被保留（llm2的置信度0.8高于语法阈值0.75，应该通过）
      expect(results.find(r => r.id === 'llm2')).toBeDefined();
      
      // 冲突、低置信度和无意义的结果应该被过滤
      expect(results.find(r => r.id === 'llm1')).toBeUndefined();
      expect(results.find(r => r.id === 'llm3')).toBeUndefined();
      expect(results.find(r => r.id === 'llm4')).toBeUndefined();
    });
  });
});
