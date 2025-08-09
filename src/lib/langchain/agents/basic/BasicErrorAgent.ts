import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { getLLM } from '@/lib/langchain/models/llm-config';
import { z } from 'zod';
import { extractJsonArrayFromContent, toErrorItems } from '@/lib/langchain/utils/llm-output';
import { PromptTemplate } from '@langchain/core/prompts';
import { guardLLMInvoke } from '@/lib/langchain/utils/llm-guard';
import { logger } from '@/lib/logger';

// 定义 BasicErrorAgent 的输入结构
const BasicErrorAgentInputSchema = z.object({
  text: z.string(),
});

type BasicErrorAgentInput = z.infer<typeof BasicErrorAgentInputSchema>;

// BasicErrorAgent 的 Prompt 模板
const BASIC_ERROR_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `
你是一位严格的中文“基础错误”检测专家，仅检测客观且可验证的错误，并给出可直接替换的修复建议。请严格遵守以下规范：

一、检测范围（必须严格遵守）
1) 拼写（spelling）：错别字、同音/近形误用（例："利害"→"厉害"）。
2) 标点（punctuation）：
   - 类型错误（中文场景中用到的逗号、句号等应为全角：，。；：？！“”‘’《》）
   - 重复或多余标点（例："。。。"→"……" 或 "。"→"。"）
   - 全半角混用（例：","→"，"）
   - 成对标点不匹配（例：开引号/闭引号不成对）
   - 注意：纯“缺失标点”的插入类修改不可直接报告（见“编辑原则”第4条）。
3) 基础语法（grammar）：
   - 明显的量词错误（例："一棵苹果"→"一个苹果"）
   - 主谓搭配明显不当、成分残缺或明显重复（客观可判定）

二、明确排除（不得输出）
- 风格优化、语气/遣词润色、长句拆分等主观改写
- 语义可通但有提升空间的建议（例如“更自然的说法”）
- 需要上下文知识才能确定的推断式修改

三、输出格式（仅输出 JSON 数组，不要任何额外文字）
数组中每个对象字段如下：
- "type": 必须为 "spelling" | "punctuation" | "grammar" 之一
- "text": 原文中有误的片段（必须与原文在 [start,end) 完全一致）
- "start": 起始索引（基于 JavaScript 字符串下标，UTF-16 code unit 计数）
- "end": 结束索引（不包含），且必须满足 end > start
- "suggestion": 用于直接替换的修复文本；若语义为“删除”，则置为空字符串 ""
- "description": 简要错误说明（客观陈述，不要主观建议）
- "quote": 必须与 "text" 完全一致（用于校验）
- "confidence": 0~1 之间的小数（建议 0.6~0.95），仅在确定性较高时输出

四、定位与索引规则
1) 索引必须准确：original.slice(start, end) === text。
2) 若需“插入”标点（无法用空 span 表达），请选择与插入点相邻的最小可替换片段，使得用 suggestion 替换该片段后能等价于“插入”。
   例：原文 "你好吗" 需要在 "好" 后加逗号，可将 text 设为 "你好"，suggestion 设为 "你好，"（确保替换后得到插入效果）。
3) 同一处错误仅输出一次，避免重复与重叠；若存在多个可表达方式，选择跨度最小且最不破坏上下文的一种。
4) 不确定时不报错；无法精确定位的不要输出。

五、编辑原则
1) 采用最小编辑原则，尽量只更正必要字符，不做大段改写。
2) 保持原有空格/换行不变，除非它们本身构成错误。
3) 建议必须使句子在客观语法/标点层面更正确，不引入风格化改写。
4) 不产生“纯插入”的空区间；如需插入，按“定位与索引规则”第2点处理。

六、质量与上限
- 请去重并避免重叠区间；尽量控制在 200 条以内。

待检测文本：
{text}

示例 1：
输入：他是一个很利害的人，买了一棵苹果
输出：
[
  {{
    "type": "spelling",
    "text": "利害",
    "start": 6,
    "end": 8,
    "suggestion": "厉害",
    "description": "同音字误用，应为‘厉害’",
    "quote": "利害",
    "confidence": 0.9
  }},
  {{
    "type": "grammar",
    "text": "一棵苹果",
    "start": 12,
    "end": 16,
    "suggestion": "一个苹果",
    "description": "量词错误，‘苹果’应配‘个’",
    "quote": "一棵苹果",
    "confidence": 0.85
  }}
]

示例 2（标点半角→全角）：
输入：今天下雨了,我没带伞。
输出：
[
  {{
    "type": "punctuation",
    "text": ",",
    "start": 5,
    "end": 6,
    "suggestion": "，",
    "description": "中文语境下应使用全角逗号",
    "quote": ",",
    "confidence": 0.9
  }}
]
`,
});

/**
 * BasicErrorAgent 负责检测基础的、客观的错误：拼写、标点、基础语法
 */
export class BasicErrorAgent extends BaseAgent<BasicErrorAgentInput> {
  constructor() {
    super('BasicErrorAgent');
  }

  async call(input: BasicErrorAgentInput, signal?: AbortSignal): Promise<AgentResponse> {
    const llm = getLLM();

    try {
      const formattedPrompt = await BASIC_ERROR_PROMPT.format({ text: input.text });
      const response = await guardLLMInvoke(
        (innerSignal) => llm.invoke(formattedPrompt as unknown as string, { signal: innerSignal } as any),
        {
          operationName: 'BasicErrorAgent.llm',
          parentSignal: signal,
        }
      );
      const rawOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      
      // 统一解析 LLM 输出
      const rawItems = extractJsonArrayFromContent(response.content);
      
      // 分别处理不同类型的错误
      const allErrors: ErrorItem[] = [];
      
      for (const rawItem of rawItems) {
        if (rawItem && typeof rawItem === 'object' && 'type' in rawItem) {
          const type = rawItem.type;
          if (type === 'spelling' || type === 'punctuation' || type === 'grammar') {
            const processedErrors = toErrorItems([rawItem], {
              enforcedType: type,
              originalText: input.text,
            });
            allErrors.push(...processedErrors);
          }
        }
      }

      return { 
        result: allErrors,
        rawOutput
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('BasicErrorAgent.invoke.error', { error: errorMessage });
      return { 
        result: [],
        error: errorMessage
      };
    }
  }
}
