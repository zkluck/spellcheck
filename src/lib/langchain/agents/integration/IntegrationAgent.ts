import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { z } from 'zod';
import { mergeErrors } from '@/lib/langchain/merge';

// 定义 IntegrationAgent 的输入结构
const IntegrationAgentInputSchema = z.object({
  text: z.string(),
  errors: z.array(z.array(z.any())), // 接收来自不同智能体的异构错误列表
});

type IntegrationAgentInput = z.infer<typeof IntegrationAgentInputSchema>;

/**
 * IntegrationAgent 负责合并、去重和解决来自不同检测智能体的错误项冲突。
 * 它不与 LLM 交互，而是通过代码逻辑处理数据。
 */
export class IntegrationAgent extends BaseAgent<IntegrationAgentInput> {
  constructor() {
    super('IntegrationAgent');
  }

  async call(input: IntegrationAgentInput): Promise<AgentResponse> {
    // 使用统一的合并策略
    const integratedErrors: ErrorItem[] = mergeErrors(input.text, input.errors as ErrorItem[][]);
    return { result: integratedErrors };
  }
}
