/**
 * 常见错误词典
 */
export const commonErrors = {
  // 的/地/得混用
  spelling: [
    { wrong: '跑的很快', correct: '跑得很快', type: 'de_confusion' },
    { wrong: '认真的学习', correct: '认真地学习', type: 'de_confusion' },
    { wrong: '美丽地花朵', correct: '美丽的花朵', type: 'de_confusion' },
    
    // 常见错别字
    { wrong: '再见', correct: '再见', type: 'homophone', context: 'farewell' },
    { wrong: '在见', correct: '再见', type: 'homophone', context: 'farewell' },
    { wrong: '做作业', correct: '做作业', type: 'homophone', context: 'homework' },
    { wrong: '作作业', correct: '做作业', type: 'homophone', context: 'homework' },
    
    // 数字量词
    { wrong: '一个人', correct: '一位人', type: 'measure_word' },
    { wrong: '两个老师', correct: '两位老师', type: 'measure_word' },
    { wrong: '三个医生', correct: '三位医生', type: 'measure_word' },
  ],

  // 标点符号
  punctuation: [
    { wrong: '你好！！', correct: '你好！', type: 'duplicate_punct' },
    { wrong: '什么？？', correct: '什么？', type: 'duplicate_punct' },
    { wrong: '真的。。。', correct: '真的……', type: 'ellipsis' },
    { wrong: '然后...', correct: '然后……', type: 'ellipsis' },
  ],

  // 语法错误
  grammar: [
    { wrong: '我很喜欢吃苹果的', correct: '我很喜欢吃苹果', type: 'redundant_de' },
    { wrong: '这个问题很难的', correct: '这个问题很难', type: 'redundant_de' },
    { wrong: '天气很好的', correct: '天气很好', type: 'redundant_de' },
  ]
};

/**
 * 专业术语词典
 */
export const professionalTerms = {
  // 技术术语
  technology: [
    '人工智能', 'AI', '机器学习', '深度学习', '神经网络',
    '算法', '数据结构', '编程', '软件工程', '云计算',
    '大数据', '区块链', '物联网', 'API', '前端', '后端'
  ],

  // 医学术语
  medical: [
    '症状', '诊断', '治疗', '药物', '手术', '康复',
    '病理', '生理', '解剖', '免疫', '感染', '炎症'
  ],

  // 法律术语
  legal: [
    '合同', '协议', '法律', '法规', '条款', '权利',
    '义务', '责任', '诉讼', '仲裁', '证据', '判决'
  ],

  // 金融术语
  finance: [
    '投资', '理财', '股票', '债券', '基金', '保险',
    '银行', '贷款', '利率', '汇率', '风险', '收益'
  ],

  // 教育术语
  education: [
    '教学', '课程', '学习', '考试', '评估', '教育',
    '学生', '老师', '教授', '研究', '论文', '学位'
  ],

  // 体育术语
  sports: [
    '训练', '比赛', '运动员', '教练', '战术', '技能',
    '体能', '竞技', '冠军', '团队', '个人', '成绩'
  ]
};

/**
 * 语境相关的词汇替换
 */
export const contextualReplacements = {
  formal: {
    '很好': '良好',
    '不错': '优秀',
    '挺好的': '相当不错',
    '还行': '尚可'
  },
  
  casual: {
    '良好': '很好',
    '优秀': '不错',
    '相当不错': '挺好的',
    '尚可': '还行'
  }
};
