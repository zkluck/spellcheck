/**
 * 检测准确性改进演示
 * 展示规则引擎 + LLM + 后处理器的协同工作效果
 */

import { ruleEngine } from '@/lib/rules/engine';
import { ResultPostProcessor } from '@/lib/rules/postprocessor';
import { ErrorItem } from '@/types/error';

// 模拟测试文本
const testTexts = [
  '他认真的学习数学！！这很重要。一个人应该努力。',
  '我跑的很快，但是写字的时候很慢。',
  '今天天气很好！！！我们去公园散步吧？？',
  '这本书很有趣，那个老师讲课也很生动。',
  '他进行了一个深入的研究，得出了重要结论。'
];

// 模拟 LLM 检测结果
function mockLLMDetection(text: string): ErrorItem[] {
  const results: ErrorItem[] = [];
  
  // 模拟一些 LLM 可能检测到的错误
  if (text.includes('进行了一个')) {
    results.push({
      id: 'llm_fluency_1',
      start: text.indexOf('进行了一个深入的研究'),
      end: text.indexOf('进行了一个深入的研究') + '进行了一个深入的研究'.length,
      text: '进行了一个深入的研究',
      suggestion: '深入研究',
      type: 'fluency',
      explanation: '简化冗余表达',
      metadata: { confidence: 0.85, source: 'llm' }
    });
  }
  
  return results;
}

/**
 * 演示检测准确性改进效果
 */
export async function demonstrateAccuracyImprovement() {
  console.log('🚀 检测准确性改进演示\n');
  
  for (const text of testTexts) {
    console.log(`📝 原文: "${text}"`);
    console.log('─'.repeat(50));
    
    // 1. 规则引擎检测
    const ruleResults = ruleEngine.detect(text);
    console.log(`🔧 规则引擎检测到 ${ruleResults.length} 个错误:`);
    ruleResults.forEach((error, index) => {
      console.log(`  ${index + 1}. [${error.type}] "${error.text}" → "${error.suggestion}"`);
      console.log(`     ${error.explanation} (置信度: ${error.metadata?.confidence})`);
    });
    
    // 2. 模拟 LLM 检测
    const llmResults = mockLLMDetection(text);
    console.log(`🤖 LLM 检测到 ${llmResults.length} 个错误:`);
    llmResults.forEach((error, index) => {
      console.log(`  ${index + 1}. [${error.type}] "${error.text}" → "${error.suggestion}"`);
      console.log(`     ${error.explanation} (置信度: ${error.metadata?.confidence})`);
    });
    
    // 3. 后处理器合并优化
    const finalResults = ResultPostProcessor.process(ruleResults, llmResults);
    console.log(`✨ 最终结果 ${finalResults.length} 个错误:`);
    finalResults.forEach((error, index) => {
      console.log(`  ${index + 1}. [${error.type}] "${error.text}" → "${error.suggestion}"`);
      console.log(`     ${error.explanation} (来源: ${error.metadata?.source})`);
    });
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
  
  // 显示规则引擎统计
  const stats = ruleEngine.getStats();
  console.log('📊 规则引擎统计:');
  console.log(`  总规则数: ${stats.total}`);
  console.log(`  启用规则数: ${stats.enabled}`);
  console.log('  分类统计:');
  Object.entries(stats.byType).forEach(([type, count]) => {
    console.log(`    ${type}: ${count} 条规则`);
  });
}

/**
 * 性能对比演示
 */
export function demonstratePerformanceImprovement() {
  console.log('⚡ 性能改进演示\n');
  
  const testText = '他认真的学习！！一个人走过来。';
  const iterations = 1000;
  
  // 规则引擎性能测试
  console.time('规则引擎检测');
  for (let i = 0; i < iterations; i++) {
    ruleEngine.detect(testText);
  }
  console.timeEnd('规则引擎检测');
  
  console.log(`\n📈 规则引擎优势:`);
  console.log(`  • 即时响应，无网络延迟`);
  console.log(`  • 一致性检测，相同错误总是相同结果`);
  console.log(`  • 高置信度，基于明确规则`);
  console.log(`  • 可扩展，支持自定义规则`);
}

// 如果直接运行此文件
if (require.main === module) {
  demonstrateAccuracyImprovement().then(() => {
    demonstratePerformanceImprovement();
  });
}
