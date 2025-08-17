import { ErrorItem } from '@/types/error';
import { config } from '@/lib/config';

/**
 * 结果后处理器 - 验证和过滤检测结果
 */
export class ResultPostProcessor {
  /**
   * 处理检测结果
   */
  static process(
    ruleResults: ErrorItem[],
    llmResults: ErrorItem[],
    enabledTypes?: string[]
  ): ErrorItem[] {
    // 合并结果
    const allResults = [...ruleResults, ...llmResults];
    
    // 应用置信度阈值过滤
    const filteredResults = this.applyConfidenceThresholds(allResults);
    
    // 去重和冲突解决
    const deduplicatedResults = this.resolveConflicts(filteredResults);
    
    // 按类型过滤
    const typeFilteredResults = this.filterByTypes(deduplicatedResults, enabledTypes);
    
    // 逻辑验证
    const validatedResults = this.validateResults(typeFilteredResults);
    
    return validatedResults;
  }

  /**
   * 应用置信度阈值过滤
   */
  private static applyConfidenceThresholds(results: ErrorItem[]): ErrorItem[] {
    const thresholds = config.detection.thresholds;
    
    return results.filter(item => {
      const confidence = item.metadata?.confidence ?? 0.5;
      const threshold = thresholds[item.type as keyof typeof thresholds] ?? 0.5;
      return confidence >= threshold;
    });
  }

  /**
   * 解决冲突和去重
   */
  private static resolveConflicts(results: ErrorItem[]): ErrorItem[] {
    // 按位置分组
    const positionGroups = new Map<string, ErrorItem[]>();
    
    for (const item of results) {
      const key = `${item.start}-${item.end}`;
      if (!positionGroups.has(key)) {
        positionGroups.set(key, []);
      }
      positionGroups.get(key)!.push(item);
    }

    const resolvedResults: ErrorItem[] = [];

    // 处理每个位置组
    Array.from(positionGroups.values()).forEach((group: ErrorItem[]) => {
      if (group.length === 1) {
        resolvedResults.push(group[0]);
      } else {
        // 冲突解决：优先选择规则引擎结果，然后按置信度
        const ruleEngineResults = group.filter((item: ErrorItem) => 
          item.metadata?.source === 'rule_engine'
        );
        
        if (ruleEngineResults.length > 0) {
          // 选择置信度最高的规则引擎结果
          const best = ruleEngineResults.reduce((a: ErrorItem, b: ErrorItem) => 
            (a.metadata?.confidence ?? 0) > (b.metadata?.confidence ?? 0) ? a : b
          );
          resolvedResults.push(best);
        } else {
          // 选择置信度最高的 LLM 结果
          const best = group.reduce((a: ErrorItem, b: ErrorItem) => 
            (a.metadata?.confidence ?? 0) > (b.metadata?.confidence ?? 0) ? a : b
          );
          resolvedResults.push(best);
        }
      }
    });

    return resolvedResults;
  }

  /**
   * 按类型过滤
   */
  private static filterByTypes(results: ErrorItem[], enabledTypes?: string[]): ErrorItem[] {
    if (!enabledTypes || enabledTypes.length === 0) {
      return results;
    }
    
    return results.filter(item => enabledTypes.includes(item.type));
  }

  /**
   * 逻辑验证
   */
  private static validateResults(results: ErrorItem[]): ErrorItem[] {
    return results.filter(item => {
      // 基本验证
      if (!item.text || !item.suggestion || item.start >= item.end) {
        return false;
      }

      // 避免无意义的替换
      if (item.text === item.suggestion) {
        return false;
      }

      // 长度合理性检查
      if (item.text.length > 100 || item.suggestion.length > 100) {
        return false;
      }

      // 特定类型验证
      return this.validateByType(item);
    });
  }

  /**
   * 按类型验证
   */
  private static validateByType(item: ErrorItem): boolean {
    switch (item.type) {
      case 'spelling':
        return this.validateSpelling(item);
      case 'punctuation':
        return this.validatePunctuation(item);
      case 'grammar':
        return this.validateGrammar(item);
      case 'fluency':
        return this.validateFluency(item);
      default:
        return true;
    }
  }

  /**
   * 拼写验证
   */
  private static validateSpelling(item: ErrorItem): boolean {
    // 避免过度纠正常见词汇
    const commonWords = ['的', '地', '得', '在', '再', '做', '作'];
    const isCommonWord = commonWords.some(word => 
      item.text.includes(word) || item.suggestion.includes(word)
    );
    
    if (isCommonWord) {
      // 对常见词汇要求更高的置信度
      return (item.metadata?.confidence ?? 0) >= 0.9;
    }
    
    return true;
  }

  /**
   * 标点验证
   */
  private static validatePunctuation(item: ErrorItem): boolean {
    // 标点符号替换应该保持文本长度相近
    const lengthDiff = Math.abs(item.text.length - item.suggestion.length);
    return lengthDiff <= 2;
  }

  /**
   * 语法验证
   */
  private static validateGrammar(item: ErrorItem): boolean {
    // 语法修改不应该大幅改变文本结构
    const textChars = item.text.length;
    const suggestionChars = item.suggestion.length;
    const charDiff = Math.abs(textChars - suggestionChars);
    
    // 允许较小的字符数变化（如量词替换）
    return charDiff <= Math.max(2, textChars * 0.5);
  }

  /**
   * 流畅性验证
   */
  private static validateFluency(item: ErrorItem): boolean {
    // 流畅性修改应该保持语义相近
    // 这里可以添加更复杂的语义相似度检查
    return item.text.length > 0 && item.suggestion.length > 0;
  }
}
