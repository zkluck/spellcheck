import { describe, it, expect } from 'vitest';
import { ResultPostProcessor } from '@/lib/rules/postprocessor';
import { ErrorItem } from '@/types/error';

describe('ResultPostProcessor', () => {
  const createErrorItem = (
    id: string,
    start: number,
    end: number,
    type: string,
    confidence: number,
    source: 'rule_engine' | 'llm' = 'llm'
  ): ErrorItem => {
    // 模拟测试数据
    function createErrorItem(partial: Partial<ErrorItem>): ErrorItem {
      return {
        id: partial.id ?? 'test-id',
        start: partial.start ?? 0,
        end: partial.end ?? 5,
        text: partial.text ?? '错误',
        suggestion: partial.suggestion ?? '修正',
        type: partial.type ?? 'error',
        explanation: partial.explanation ?? '测试说明',
        metadata: partial.metadata,
      };
    }

    return createErrorItem({
      id,
      start,
      end,
      type,
      metadata: {
        confidence,
        source,
        description: `Description for ${id}`
      }
    });
  }

  describe('置信度阈值过滤', () => {
    it('应该过滤低置信度的结果', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        createErrorItem('1', 0, 4, 'error', 0.9),
        createErrorItem('2', 5, 9, 'error', 0.4), // 低于默认阈值 0.65
        createErrorItem('3', 10, 14, 'error', 0.7), // 高于默认阈值 0.65
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
        createErrorItem('rule1', 0, 4, 'fluency', 0.9, 'rule_engine')
      ];
      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 4, 'fluency', 0.95, 'llm')
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('rule1');
      expect(results[0].metadata?.source).toBe('rule_engine');
    });

    it('应该在无规则引擎结果时选择高置信度LLM结果', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 4, 'fluency', 0.9, 'llm'),
        createErrorItem('llm2', 0, 4, 'fluency', 0.95, 'llm')
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
        { ...createErrorItem('1', 0, 4, 'fluency', 0.9), text: 'test', suggestion: 'test' }, // 相同文本
        createErrorItem('2', 5, 9, 'fluency', 0.9), // 正常替换
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });

    it('应该过滤无效的索引范围', () => {
      const ruleResults: ErrorItem[] = [];
      const llmResults: ErrorItem[] = [
        { ...createErrorItem('1', 5, 5, 'fluency', 0.9) }, // start >= end
        { ...createErrorItem('2', 10, 5, 'fluency', 0.9) }, // start > end
        createErrorItem('3', 0, 4, 'fluency', 0.9), // 正常范围
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('3');
    });
  });

  describe('综合测试', () => {
    it('应该正确处理复杂的混合场景', () => {
      const ruleResults: ErrorItem[] = [
        createErrorItem('rule1', 0, 2, 'fluency', 0.95, 'rule_engine'),
        createErrorItem('rule2', 10, 12, 'fluency', 0.9, 'rule_engine'),
      ];

      const llmResults: ErrorItem[] = [
        createErrorItem('llm1', 0, 2, 'fluency', 0.98, 'llm'), // 与rule1冲突
        createErrorItem('llm2', 5, 8, 'fluency', 0.8, 'llm'), // 独立结果
        createErrorItem('llm3', 15, 18, 'fluency', 0.3, 'llm'), // 低置信度
        { ...createErrorItem('llm4', 20, 24, 'fluency', 0.9, 'llm'), text: 'same', suggestion: 'same' }, // 无意义替换
      ];

      const results = ResultPostProcessor.process(ruleResults, llmResults);

      expect(results).toHaveLength(3);

      // 规则引擎结果应该被保留
      expect(results.find(r => r.id === 'rule2')).toBeDefined();

      // 独立的LLM结果应该被保留（llm2的置信度0.8高于fluency阈值0.65，应该通过）
      expect(results.find(r => r.id === 'llm2')).toBeDefined();

      // 冲突、低置信度和无意义的结果应该被过滤
      expect(results.find(r => r.id === 'llm1')).toBeUndefined();
      expect(results.find(r => r.id === 'llm3')).toBeUndefined();
      expect(results.find(r => r.id === 'llm4')).toBeUndefined();
    });
  });
});
