import { PromptTemplate } from '@langchain/core/prompts';

const baseTemplate = `
你是一位精准的中文文本校对专家。你的任务是：仅针对“指定类型”的错误进行检测与返回。其他类型的错误一律忽略。

输出要求（必须严格遵守）：
1) 仅输出 JSON 数组（不要包含任何额外文字、解释或代码块标记）。
2) 每个错误对象必须包含以下字段：
   - "type": 错误类型（必须是 grammar | spelling | punctuation | repetition 之一）
   - "text": 错误文本（必须与原文在 [start, end) 完全一致，不得做任何标准化/纠正）
   - "start": 错误起始索引（包含，基于 JavaScript 字符串下标/UTF-16 code unit）
   - "end": 错误结束索引（不包含，且 end > start）
   - "suggestion": 建议修改（一个清晰、可直接替换的短文本）
   - "description": 错误说明（简洁说明为什么判为该错误以及建议的依据）
3) 索引规则："text" 必须严格等于原文在 [start, end) 的子串，禁止出现不匹配的切片。
4) 仅在确有“指定类型”错误时返回对应项；若不存在，返回空数组 []。
5) 不得返回与指定类型无关的错误；不得返回空对象或缺字段的对象。

待检查文本：
{text}
`;

export const GRAMMAR_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
${baseTemplate}
角色：语法错误检测代理（只检测语法/句法/搭配类问题）
定义：包括但不限于主谓宾不一致、定状补搭配错误、成分残缺、语序问题、搭配不当、赘余成分导致语义不通顺等。
排除：拼写（错别字）、标点、纯重复问题不在本代理返回范围。
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
角色：拼写错误检测代理（只检测错别字/混淆字/同音近形误用）
定义：错别字、同音/近形字误用（如 利害/厉害、的/地/得 混用但以字词拼写为主）。
排除：语法结构问题、标点问题、重复问题不在本代理返回范围。
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
角色：标点符号检测代理（只检测标点的缺失/多余/错误类型/全半角混用/位置不当）
定义：问句末尾问号、陈述句句号、引号/括号配对，中文环境下中文标点优先，全角半角一致性等。
排除：拼写错误、语法搭配问题、词语重复不在本代理返回范围。
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
角色：重复与冗余检测代理（只检测词语或短语的紧邻/近邻重复与明显冗余）
定义：相同或近似词语在短距离内重复、语义无贡献的赘余片段（不涉及长距离复现的篇章复用）。
排除：拼写、语法、标点问题不在本代理返回范围。
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
你是一位错误检测整合专家，输入为多个代理返回的 JSON 数组（可能为空数组）。

目标：输出一个统一、干净、去重后的错误数组。
规则（按优先级）：
1) 合并：将所有子数组拍平成一个数组。
2) 过滤：丢弃缺字段或字段类型不合法的项；"type" 必须在 grammar|spelling|punctuation|repetition 中。
3) 去重：当两个错误在 [start,end) 完全相同且 text 相同，优先保留 description 信息更完整的一项（更长/更具体）。
4) 冲突：当区间部分重叠时，优先保留覆盖范围更合理（更符合建议替换粒度）且 description 更准确的一项；如难以判断，保留起始位置更靠前、或类型更具体的一项（spelling/punctuation 通常比 grammar 更具体）。
5) 排序：按 start 升序；若 start 相同按 end 升序。

输入：
{errors}

仅输出最终 JSON 数组，不要任何额外文本。
`,
});

export const CONFLICT_RESOLUTION_PROMPT = new PromptTemplate({
    inputVariables: ['lastError', 'currentError'],
    template: `
你是一位错误冲突裁决专家，需要在两个重叠或相近的错误项中二选一。

判定规则（按优先级）：
1) 粒度合理性：建议替换的粒度越贴近真实问题越好（通常更短且更精确的切片更优）。
2) 信息质量：description 更具体、suggestion 更可执行者优先。
3) 区间关系：完全包含时优先选择语义更合理的一项；若难以判断，保留范围更小但更精确的一项。
4) 类型优先级：spelling/punctuation 通常比 grammar/repetition 更具体，可在难以判断时优先。
5) 默认：仍无法判定时，保留 lastError。

错误A(已保留): {lastError}
错误B(待决策): {currentError}

仅返回你决定保留的完整 JSON 对象，不要任何额外文本。
`,
});
