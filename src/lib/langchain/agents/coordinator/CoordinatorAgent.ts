import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import { FluentAgent } from '@/lib/langchain/agents/fluent/FluentAgent';
import { mergeErrors } from '@/lib/langchain/merge';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// 定义 CoordinatorAgent 的输入结构
const CoordinatorAgentInputSchema = z.object({
  text: z.string(),
  options: z.object({
    enabledTypes: z.array(z.enum(['spelling', 'punctuation', 'grammar', 'fluency'])),
  }),
});

type CoordinatorAgentInput = z.infer<typeof CoordinatorAgentInputSchema>;

/**
 * CoordinatorAgent 负责协调2个检测代理，并整合它们的结果。
 * 新架构：BasicErrorAgent（基础错误）+ FluentAgent（语义通顺）
 */
export class CoordinatorAgent {
  private basicErrorAgent: BasicErrorAgent;
  private fluentAgent: FluentAgent;

  constructor() {
    this.basicErrorAgent = new BasicErrorAgent();
    this.fluentAgent = new FluentAgent();
  }

  async call(input: CoordinatorAgentInput): Promise<AgentResponse> {
    const { text, options } = input;
    const { enabledTypes } = options;

    const promises: Promise<{ agent: string; response: AgentResponse }>[] = [];
    const agentNames: string[] = [];

    // 检查是否需要基础错误检测（拼写、标点、语法）
    const needsBasicErrors = enabledTypes.some(type => 
      ['spelling', 'punctuation', 'grammar'].includes(type)
    );
    
    if (needsBasicErrors) {
      promises.push(
        this.basicErrorAgent.call({ text }).then((response: AgentResponse) => ({ agent: 'basic', response }))
      );
      agentNames.push('basic');
    }
    
    // 检查是否需要语义通顺检测
    if (enabledTypes.includes('fluency')) {
      promises.push(
        this.fluentAgent.call({ text }).then((response: AgentResponse) => ({ agent: 'fluent', response }))
      );
      agentNames.push('fluent');
    }

    // 等待所有选中的智能体完成（允许部分失败）
    const settled = await Promise.allSettled(promises);
    const rawResults: AgentResponse[] = [];
    const debugInfo: Array<{ agent: string; rawOutput: string; parsedResult: any; error?: string }> = [];
    
    settled.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        const { agent, response } = res.value;
        rawResults.push(response);
        
        // 记录调试信息
        debugInfo.push({
          agent,
          rawOutput: response.rawOutput || 'No raw output available',
          parsedResult: response.result,
          error: response.error
        });
        
        // 控制台输出调试信息
        console.log(`\n=== ${agent.toUpperCase()} AGENT DEBUG ===`);
        console.log('Raw LLM Output:', response.rawOutput);
        console.log('Parsed Result:', JSON.stringify(response.result, null, 2));
        if (response.error) {
          console.log('Error:', response.error);
        }
        console.log('='.repeat(40));
      } else {
        const agentName = agentNames[idx] || `agent-${idx}`;
        logger.warn('Agent failed', { agent: agentName, reason: (res.reason as Error)?.message });
        debugInfo.push({
          agent: agentName,
          rawOutput: '',
          parsedResult: [],
          error: (res.reason as Error)?.message || 'Unknown error'
        });
      }
    });

    // 提取所有错误项并使用简化的合并逻辑
    const allErrors = rawResults.map((result) => result.result);
    const mergedErrors = mergeErrors(text, allErrors);

    return {
      result: mergedErrors
    };
  }
}
