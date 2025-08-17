import { ErrorItem } from '@/types/error';

/**
 * 规则引擎接口
 */
export interface Rule {
  id: string;
  name: string;
  type: 'spelling' | 'grammar' | 'punctuation' | 'fluency';
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
  private rules: Map<string, Rule[]> = new Map();

  constructor() {
    this.loadBuiltinRules();
  }

  /**
   * 加载内置规则
   */
  private loadBuiltinRules(): void {
    // 拼写规则
    this.addRule({
      id: 'spelling_de_di',
      name: '的/地混用',
      type: 'spelling',
      pattern: /(认真|仔细|努力|快速|慢慢|静静|悄悄|轻轻|重重|深深)(的)(学习|工作|思考|走路|说话|看书|写字|做事)/g,
      replacement: '$1地$3',
      confidence: 0.85,
      description: '修饰动词应使用"地"',
      enabled: true
    });

    this.addRule({
      id: 'spelling_de_dei',
      name: '的/得混用',
      type: 'spelling',
      pattern: /(跑|走|说|唱|笑|哭|飞|游|跳|写)(的)(很|非常|特别|相当|十分)(快|慢|好|美|高|远|近)/g,
      replacement: '$1得$3$4',
      confidence: 0.85,
      description: '补语前应使用"得"',
      enabled: true
    });

    // 标点规则
    this.addRule({
      id: 'punct_double_exclamation',
      name: '重复感叹号',
      type: 'punctuation',
      pattern: /！{2,}/g,
      replacement: '！',
      confidence: 0.95,
      description: '感叹号通常只使用一个',
      enabled: true
    });

    this.addRule({
      id: 'punct_double_question',
      name: '重复问号',
      type: 'punctuation',
      pattern: /？{2,}/g,
      replacement: '？',
      confidence: 0.95,
      description: '问号通常只使用一个',
      enabled: true
    });

    // 语法规则
    this.addRule({
      id: 'grammar_measure_word_person',
      name: '人的量词错误',
      type: 'grammar',
      pattern: /(一|两|三|四|五|六|七|八|九|十)个(人)/g,
      replacement: '$1位$2',
      confidence: 0.80,
      description: '人应使用"位"作量词',
      enabled: true
    });

    this.addRule({
      id: 'grammar_measure_word_book',
      name: '书的量词错误',
      type: 'grammar',
      pattern: /(一|两|三|四|五|六|七|八|九|十)个(书)/g,
      replacement: '$1本$2',
      confidence: 0.80,
      description: '书应使用"本"作量词',
      enabled: true
    });
  }

  /**
   * 添加规则
   */
  addRule(rule: Rule): void {
    if (!this.rules.has(rule.type)) {
      this.rules.set(rule.type, []);
    }
    this.rules.get(rule.type)!.push(rule);
  }

  /**
   * 检测文本中的错误
   */
  detect(text: string, enabledTypes?: string[]): ErrorItem[] {
    const results: ErrorItem[] = [];
    const types = enabledTypes || ['spelling', 'grammar', 'punctuation', 'fluency'];

    for (const type of types) {
      const typeRules = this.rules.get(type as any);
      if (!typeRules) continue;

      for (const rule of typeRules) {
        if (!rule.enabled) continue;

        const matches = this.findMatches(text, rule);
        for (const match of matches) {
          results.push(this.createErrorItem(match));
        }
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
      type: match.rule.type,
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
    let total = 0;
    let enabled = 0;
    const byType: Record<string, number> = {};

    this.rules.forEach((rules, type) => {
      byType[type] = rules.length;
      total += rules.length;
      enabled += rules.filter((r: Rule) => r.enabled).length;
    });

    return { total, enabled, byType };
  }
}

// 导出单例实例
export const ruleEngine = new RuleEngine();
