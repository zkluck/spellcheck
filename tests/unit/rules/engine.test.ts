import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine, Rule } from '@/lib/rules/engine';

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe('规则管理', () => {
    it('应该能添加自定义规则', () => {
      const customRule: Rule = {
        id: 'test_rule',
        name: '测试规则',
        pattern: /测试错误/g,
        replacement: '测试正确',
        confidence: 0.9,
        description: '测试用规则',
        enabled: true
      };

      engine.addRule(customRule);

      const text = '这是一个测试错误的例子';
      const results = engine.detect(text);

      const testResult = results.find(r => r.metadata?.ruleId === 'test_rule');
      expect(testResult).toBeDefined();
      expect(testResult?.suggestion).toBe('测试正确');
      // 错误类型已移除，不再验证 type 字段
    });

    it('应该返回正确的统计信息', () => {
      const stats = engine.getStats();

      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.enabled).toBeGreaterThanOrEqual(0);
      expect(stats.byType).toEqual({});
    });
  });

  describe('检测功能', () => {
    it('应该检测到规则匹配的错误', () => {
      const customRule: Rule = {
        id: 'test_pattern',
        name: '测试模式',
        pattern: /错误/g,
        replacement: '正确',
        confidence: 0.8,
        description: '测试模式匹配',
        enabled: true
      };

      engine.addRule(customRule);

      const text = '这是一个错误的例子';
      const results = engine.detect(text);

      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('错误');
      expect(results[0].suggestion).toBe('正确');
      // 错误类型已移除，不再验证 type 字段
    });

    it('应该在未指定类型时返回所有错误', () => {
      const rule1: Rule = {
        id: 'rule1',
        name: '规则1',
        pattern: /错误1/g,
        replacement: '正确1',
        confidence: 0.8,
        description: '测试规则1',
        enabled: true
      };

      const rule2: Rule = {
        id: 'rule2',
        name: '规则2',
        pattern: /错误2/g,
        replacement: '正确2',
        confidence: 0.9,
        description: '测试规则2',
        enabled: true
      };

      engine.addRule(rule1);
      engine.addRule(rule2);

      const text = '这是一个错误1，也是一个错误2';
      const results = engine.detect(text);

      expect(results).toHaveLength(2);
      const rule1Result = results.find(r => r.metadata?.ruleId === 'rule1');
      const rule2Result = results.find(r => r.metadata?.ruleId === 'rule2');

      expect(rule1Result).toBeDefined();
      expect(rule2Result).toBeDefined();
    });
  });

  describe('去重功能', () => {
    it('应该去除重复的检测结果', () => {
      // 添加两个会产生相同结果的规则
      const rule1: Rule = {
        id: 'dup_rule_1',
        name: '重复规则1',
        pattern: /错误/g,
        replacement: '正确',
        confidence: 0.8,
        description: '重复测试规则1',
        enabled: true
      };

      const rule2: Rule = {
        id: 'dup_rule_2',
        name: '重复规则2',
        pattern: /错误/g,
        replacement: '正确',
        confidence: 0.9,
        description: '重复测试规则2',
        enabled: true
      };

      engine.addRule(rule1);
      engine.addRule(rule2);

      const text = '这是错误的';
      const results = engine.detect(text);

      // 应该只有一个结果，因为重复的被去除了
      const errorResults = results.filter(r =>
        r.metadata?.ruleId === 'dup_rule_1' || r.metadata?.ruleId === 'dup_rule_2'
      );
      expect(errorResults).toHaveLength(1);
    });
  });
});
