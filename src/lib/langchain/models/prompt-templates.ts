import { PromptTemplate } from '@langchain/core/prompts';

const baseTemplate = `
你是一位精准的中文文本校对专家，专注于检测特定类型的文本错误。

**输出格式要求（严格遵守）：**
1. 返回格式：JSON数组
2. 每个错误对象必须包含字段：
   - "type": 错误类型
   - "text": 错误文本（必须与原文完全一致）
   - "start": 错误起始索引
   - "end": 错误结束索引（不含此位置）
   - "suggestion": 建议修改
   - "description": 错误说明
3. 索引必须精确："text"必须等于原文中[start,end)的子串
4. 无错误时返回空数组[]

待检查文本：
{text}

按以下格式返回结果：
`;

export const GRAMMAR_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
${baseTemplate}
类型：语法错误
示例：
原始文本：我昨天买一棵苹果。
返回：
[
  {{
    "type": "grammar",
    "text": "一棵苹果",
    "start": 4,
    "end": 8,
    "suggestion": "一个苹果",
    "description": "量词使用错误，'苹果'的量词应该是'个'。"
  }}
]
`,
});

export const SPELLING_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
${baseTemplate}
类型：拼写错误（错别字）
示例：
原始文本：他是一个很利害的人。
返回：
[
  {{
    "type": "spelling",
    "text": "利害",
    "start": 6,
    "end": 8,
    "suggestion": "厉害",
    "description": "'利害'应为'厉害'。"
  }}
]
`,
});

export const PUNCTUATION_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
${baseTemplate}
类型：标点符号错误
示例：
原始文本：你今天怎么样。
返回：
[
  {{
    "type": "punctuation",
    "text": "。",
    "start": 6,
    "end": 7,
    "suggestion": "？",
    "description": "问句应使用问号结尾。"
  }}
]
`,
});

export const REPETITION_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
${baseTemplate}
类型：重复用词
示例：
原始文本：这是一个非常非常重要的问题。
返回：
[
  {{
    "type": "repetition",
    "text": "非常非常",
    "start": 4,
    "end": 8,
    "suggestion": "非常",
    "description": "'非常'一词重复。"
  }}
]
`,
});

// Prompts for Integration and Conflict Resolution remain the same as they operate on structured data, not raw text indexing.

export const INTEGRATION_PROMPT = new PromptTemplate({
    inputVariables: ['errors'],
    template: `
你是一位错误检测整合专家，需要合并多个AI模型的检测结果。

任务（按优先级）：
1. 合并所有子数组为一个统一错误列表
2. 去重：当错误完全重叠时，保留描述最全面的一项
3. 解决冲突：当错误部分重叠时，选择覆盖范围更广或更精确的一项
4. 排序：按错误在原文中的起始位置（start值）排序

输入数据（每个子数组代表一个AI模型的输出）：
{errors}

仅返回最终JSON数组，无需任何额外解释。
`,
});

export const CONFLICT_RESOLUTION_PROMPT = new PromptTemplate({
    inputVariables: ['lastError', 'currentError'],
    template: `
你是一位错误冲突裁决专家，需要在两个重叠的错误项中选择一个保留。

决策规则（按优先级）：
1. 范围优先：当一个错误完全包含另一个时，保留范围更广的错误
   例：A[5,10]完全包含B[6,8]，应保留A
2. 质量优先：当错误部分重叠时，保留描述更准确或建议更合理的一个
   例：A[5,10]与B[8,12]部分重叠，根据质量选择
3. 默认策略：无法判断时，保留第一个错误(lastError)

错误A(已保留): {lastError}
错误B(待决策): {currentError}

直接返回你决定保留的错误项的完整JSON对象。
`,
});
