import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import { FluentAgent } from '@/lib/langchain/agents/fluent/FluentAgent';
import { mergeErrors } from '@/lib/langchain/merge';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { ReviewerAgent } from '@/lib/langchain/agents/reviewer/ReviewerAgent';

// 定义 CoordinatorAgent 的输入结构
const CoordinatorAgentInputSchema = z.object({
  text: z.string(),
  options: z.object({
    enabledTypes: z.array(z.enum(['spelling', 'punctuation', 'grammar', 'fluency'])),
  }),
});

type CoordinatorAgentInput = z.infer<typeof CoordinatorAgentInputSchema>;

// 流式回调函数类型
type StreamCallback = (chunk: { agent: string; response: AgentResponse }) => void;

/**
 * CoordinatorAgent 负责协调多个检测代理，并支持流式返回结果。
 */
export class CoordinatorAgent {
  private basicErrorAgent: BasicErrorAgent;
  private fluentAgent: FluentAgent;
  private reviewerAgent: ReviewerAgent;

  constructor() {
    this.basicErrorAgent = new BasicErrorAgent();
    this.fluentAgent = new FluentAgent();
    this.reviewerAgent = new ReviewerAgent();
  }

  async call(input: CoordinatorAgentInput, streamCallback?: StreamCallback): Promise<AgentResponse> {
    const { text, options } = input;
    const { enabledTypes } = options;

    const promises: Promise<void>[] = [];
    const allResults: AgentResponse[] = [];

    const runAgent = (agentInstance: BasicErrorAgent | FluentAgent, agentName: string) => {
      const promise = agentInstance.call({ text })
        .then(response => {
          const chunk = { agent: agentName, response };
          if (streamCallback) {
            streamCallback(chunk);
          }
          allResults.push(response);

          // 调试信息
          logger.debug(`\n=== ${agentName.toUpperCase()} AGENT DEBUG ===`);
          logger.debug('Raw LLM Output:', response.rawOutput);
          logger.debug('Parsed Result:', JSON.stringify(response.result, null, 2));
          if (response.error) {
            logger.debug('Error:', response.error);
          }
          logger.debug('='.repeat(40));
        })
        .catch(error => {
          logger.warn('Agent failed', { agent: agentName, reason: (error as Error)?.message });
        });
      promises.push(promise);
    };

    const needsBasicErrors = enabledTypes.some(type => 
      ['spelling', 'punctuation', 'grammar'].includes(type)
    );
    
    if (needsBasicErrors) {
      runAgent(this.basicErrorAgent, 'basic');
    }
    
    if (enabledTypes.includes('fluency')) {
      runAgent(this.fluentAgent, 'fluent');
    }

    // 等待所有智能体完成（候选阶段）
    await Promise.all(promises);

    // 组装候选，进入审阅阶段（Reviewer）
    const candidateList: ErrorItem[] = allResults.flatMap(r => r.result ?? []);
    const reviewerInput = {
      text,
      candidates: candidateList.map((c) => ({
        id: c.id,
        text: c.text,
        start: c.start,
        end: c.end,
        suggestion: c.suggestion,
        type: c.type,
        explanation: c.explanation ?? '',
      })),
    };

    let refined: ErrorItem[] = [];
    try {
      const reviewRes = await this.reviewerAgent.call(reviewerInput as any);
      if (streamCallback) {
        streamCallback({ agent: 'reviewer', response: reviewRes });
      }

      logger.debug(`\n=== REVIEWER AGENT DEBUG ===`);
      logger.debug('Raw LLM Output:', reviewRes.rawOutput);
      logger.debug('Parsed Result:', JSON.stringify(reviewRes.result, null, 2));
      if (reviewRes.error) {
        logger.debug('Error:', reviewRes.error);
      }
      logger.debug('='.repeat(40));

      refined = reviewRes.result ?? [];
    } catch (e) {
      logger.warn('ReviewerAgent failed', { reason: (e as Error)?.message });
    }

    // 最终合并（主要用于去重与冲突解决）
    // 若审阅阶段无结果，则回退到原始候选的合并，避免“全空”
    const mergedErrors = refined.length > 0
      ? mergeErrors(text, [refined])
      : mergeErrors(text, allResults.map(r => r.result));

    return {
      result: mergedErrors,
    };
  }
}
