/**
 * 领域专业词典
 * 可以根据需要扩展特定领域的术语
 */

// 科学研究领域
export const scientificTerms = [
  '实验', '假设', '理论', '数据', '分析', '结论',
  '变量', '对照', '样本', '统计', '显著性', '相关性'
];

// 商业管理领域
export const businessTerms = [
  '战略', '营销', '品牌', '客户', '市场', '竞争',
  '盈利', '成本', '预算', '绩效', '团队', '领导'
];

// 艺术文化领域
export const artTerms = [
  '创作', '作品', '风格', '流派', '技法', '表现',
  '审美', '文化', '传统', '创新', '艺术家', '观众'
];

// 环境科学领域
export const environmentTerms = [
  '生态', '环境', '污染', '保护', '可持续', '气候',
  '生物多样性', '碳排放', '绿色', '循环', '节能', '减排'
];

// 心理学领域
export const psychologyTerms = [
  '认知', '情绪', '行为', '人格', '发展', '学习',
  '记忆', '注意', '感知', '动机', '压力', '适应'
];

/**
 * 合并所有领域词典
 */
export const domainDictionaries = {
  scientific: scientificTerms,
  business: businessTerms,
  art: artTerms,
  environment: environmentTerms,
  psychology: psychologyTerms
};

/**
 * 获取指定领域的术语
 */
export function getDomainTerms(domain: keyof typeof domainDictionaries): string[] {
  return domainDictionaries[domain] || [];
}

/**
 * 检查词汇是否为专业术语
 */
export function isProfessionalTerm(word: string, domain?: keyof typeof domainDictionaries): boolean {
  if (domain) {
    return getDomainTerms(domain).includes(word);
  }
  
  // 检查所有领域
  return Object.values(domainDictionaries).some(terms => terms.includes(word));
}
