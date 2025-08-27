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
    const defaultThreshold = 0.5;
    
    return results.filter(item => {
      const confidence = item.metadata?.confidence ?? 0.5;
      return confidence >= defaultThreshold;
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
    
    return results.filter(item => item.type !== undefined && enabledTypes.includes(item.type));
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
    // 不再基于类型进行验证，直接返回 true
    return true;
  }

  // spelling、punctuation、grammar 相关的验证方法已删除
}
