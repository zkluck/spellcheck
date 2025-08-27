import { ErrorItem } from '@/types/error';

/**
 * 规则引擎接口
 */
export interface Rule {
  id: string;
  name: string;
  pattern: RegExp | string;
  replacement?: string;
  confidence: number;
  description: string;
  enabled: boolean;
}

/**
 * 规则匹配结果
 */
export interface RuleMatch {
  rule: Rule;
  start: number;
  end: number;
  text: string;
  suggestion: string;
  confidence: number;
}

/**
 * 规则引擎核心类
 */
export class RuleEngine {
  private rules: Rule[] = [];

  constructor() {
    this.loadBuiltinRules();
  }

  /**
   * 加载内置规则
   */
  private loadBuiltinRules(): void {
    // 所有 spelling、grammar、punctuation 相关的规则已删除
  }

  /**
   * 添加规则
   */
  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  /**
   * 检测文本中的错误
   */
  detect(text: string): ErrorItem[] {
    const results: ErrorItem[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const matches = this.findMatches(text, rule);
      for (const match of matches) {
        results.push(this.createErrorItem(match));
      }
    }

    return this.deduplicateResults(results);
  }

  /**
   * 查找规则匹配
   */
  private findMatches(text: string, rule: Rule): RuleMatch[] {
    const matches: RuleMatch[] = [];

    if (rule.pattern instanceof RegExp) {
      let match;
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      
      while ((match = regex.exec(text)) !== null) {
        const suggestion = rule.replacement 
          ? match[0].replace(rule.pattern, rule.replacement)
          : match[0];

        matches.push({
          rule,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          suggestion,
          confidence: rule.confidence
        });

        // 防止无限循环
        if (!rule.pattern.global) break;
      }
    }

    return matches;
  }

  /**
   * 创建错误项
   */
  private createErrorItem(match: RuleMatch): ErrorItem {
    return {
      id: `rule_${match.rule.id}_${match.start}_${match.end}`,
      start: match.start,
      end: match.end,
      text: match.text,
      suggestion: match.suggestion,
      type: 'error', // 默认类型
      explanation: match.rule.description,
      metadata: {
        source: 'rule_engine',
        ruleId: match.rule.id,
        confidence: match.confidence
      }
    };
  }

  /**
   * 去重结果
   */
  private deduplicateResults(results: ErrorItem[]): ErrorItem[] {
    const seen = new Set<string>();
    return results.filter(item => {
      const key = `${item.start}:${item.end}:${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 获取规则统计
   */
  getStats(): { total: number; enabled: number; byType: Record<string, number> } {
    const total = this.rules.length;
    const enabled = this.rules.filter((rule: Rule) => rule.enabled).length;

    return { total, enabled, byType: {} };
  }
}

// 导出单例实例
export const ruleEngine = new RuleEngine();
