import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine, Rule } from '@/lib/rules/engine';

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe('基础规则检测', () => {
    it('应该检测的/地混用', () => {
      const text = '他认真的学习';
      const results = engine.detect(text, ['spelling']);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('spelling');
      expect(results[0].text).toBe('认真的学习');
      expect(results[0].suggestion).toBe('认真地学习');
      expect(results[0].explanation).toContain('修饰动词应使用"地"');
    });

    it('应该检测重复标点符号', () => {
      const text = '你好！！世界';
      const results = engine.detect(text, ['punctuation']);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('punctuation');
      expect(results[0].text).toBe('！！');
      expect(results[0].suggestion).toBe('！');
    });

    it('应该检测量词错误', () => {
      const text = '一个人走过来';
      const results = engine.detect(text, ['grammar']);
      
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('grammar');
      expect(results[0].text).toBe('一个人');
      expect(results[0].suggestion).toBe('一位人');
    });
  });

  describe('规则管理', () => {
    it('应该能添加自定义规则', () => {
      const customRule: Rule = {
        id: 'test_rule',
        name: '测试规则',
        type: 'spelling',
        pattern: /测试错误/g,
        replacement: '测试正确',
        confidence: 0.9,
        description: '测试用规则',
        enabled: true
      };

      engine.addRule(customRule);
      
      const text = '这是一个测试错误的例子';
      const results = engine.detect(text, ['spelling']);
      
      const testResult = results.find(r => r.metadata?.ruleId === 'test_rule');
      expect(testResult).toBeDefined();
      expect(testResult?.suggestion).toBe('测试正确');
    });

    it('应该返回正确的统计信息', () => {
      const stats = engine.getStats();
      
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.enabled).toBeGreaterThan(0);
      expect(stats.byType).toHaveProperty('spelling');
      expect(stats.byType).toHaveProperty('punctuation');
      expect(stats.byType).toHaveProperty('grammar');
    });
  });

  describe('类型过滤', () => {
    it('应该只返回指定类型的错误', () => {
      const text = '他认真的学习！！这很好。';
      const spellingResults = engine.detect(text, ['spelling']);
      const punctResults = engine.detect(text, ['punctuation']);
      
      expect(spellingResults.every(r => r.type === 'spelling')).toBe(true);
      expect(punctResults.every(r => r.type === 'punctuation')).toBe(true);
    });

    it('应该在未指定类型时返回所有错误', () => {
      const text = '他认真的学习！！一个人很好。';
      const allResults = engine.detect(text);
      
      const types = new Set(allResults.map(r => r.type));
      expect(types.size).toBeGreaterThan(1);
    });
  });

  describe('去重功能', () => {
    it('应该去除重复的检测结果', () => {
      // 添加两个会产生相同结果的规则
      const rule1: Rule = {
        id: 'dup_rule_1',
        name: '重复规则1',
        type: 'spelling',
        pattern: /错误/g,
        replacement: '正确',
        confidence: 0.8,
        description: '重复测试规则1',
        enabled: true
      };

      const rule2: Rule = {
        id: 'dup_rule_2',
        name: '重复规则2',
        type: 'spelling',
        pattern: /错误/g,
        replacement: '正确',
        confidence: 0.9,
        description: '重复测试规则2',
        enabled: true
      };

      engine.addRule(rule1);
      engine.addRule(rule2);
      
      const text = '这是错误的';
      const results = engine.detect(text, ['spelling']);
      
      // 应该只有一个结果，因为重复的被去除了
      const errorResults = results.filter(r => 
        r.metadata?.ruleId === 'dup_rule_1' || r.metadata?.ruleId === 'dup_rule_2'
      );
      expect(errorResults).toHaveLength(1);
    });
  });
});
