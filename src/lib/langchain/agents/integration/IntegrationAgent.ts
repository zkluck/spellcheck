import { BaseAgent } from '@/lib/langchain/agents/base/BaseAgent';
import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { z } from 'zod';

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
    console.log('--- IntegrationAgent: 开始处理 ---');
    console.log('原始输入文本长度:', input.text.length);
    console.log(
      '收到的原始错误列表 (按智能体分组):',
      JSON.stringify(input.errors, null, 2)
    );

    // 1. 扁平化并验证所有错误项
    const allErrors: ErrorItem[] = input.errors.flat().filter((error) => {
      const isValid =
        error &&
        typeof error.start === 'number' &&
        typeof error.end === 'number' &&
        error.start < error.end &&
        error.end <= input.text.length;
      if (!isValid) {
        console.warn('过滤掉无效的错误项 (结构或索引问题):', error);
      }
      return isValid;
    });

    console.log(
      '扁平化后的所有有效错误项:',
      JSON.stringify(allErrors, null, 2)
    );

    // 2. 按起始位置排序
    allErrors.sort((a, b) => a.start - b.start || a.end - b.end);

    console.log(
      '按 start 位置排序后的错误项:',
      JSON.stringify(allErrors, null, 2)
    );

    // 3. 解决重叠冲突
    const integratedErrors: ErrorItem[] = [];
    if (allErrors.length > 0) {
      let lastError = JSON.parse(JSON.stringify(allErrors[0]));

      for (let i = 1; i < allErrors.length; i++) {
        const currentError = JSON.parse(JSON.stringify(allErrors[i]));
        console.log(
          `\n处理冲突: lastError=[${lastError.start},${lastError.end}], currentError=[${currentError.start},${currentError.end}]`
        );

        // 检查是否有重叠: current 的起点在 last 的范围内
        if (currentError.start < lastError.end) {
          console.log(
            `  [冲突检测到!] currentError.start (${currentError.start}) < lastError.end (${lastError.end})`
          );
          // 冲突解决策略：保留覆盖范围更广的那个
          const lastErrorLength = lastError.end - lastError.start;
          const currentErrorLength = currentError.end - currentError.start;

          if (currentErrorLength > lastErrorLength) {
            console.log(
              `  [解决] 保留 currentError，因为它覆盖范围更广 (${currentErrorLength} > ${lastErrorLength}).`
            );
            lastError = currentError;
          } else {
            console.log(
              `  [解决] 忽略 currentError，保留 lastError，因为它覆盖范围更广或相等 (${lastErrorLength} >= ${currentErrorLength}).`
            );
          }
        } else {
          // 没有重叠，将上一个确认的错误添加到结果列表
          console.log('  [无冲突] 添加 lastError 到最终列表:', lastError);
          integratedErrors.push(lastError);
          lastError = currentError;
        }
      }
      // 将最后一个处理的错误项加入结果列表
      integratedErrors.push(lastError);
      console.log('\n循环结束，添加最后一个 lastError 到最终列表:', lastError);
    }

    console.log('--- IntegrationAgent: 处理完成 ---');
    console.log(
      '最终整合后的错误列表:',
      JSON.stringify(integratedErrors, null, 2)
    );

    return { result: integratedErrors };
  }
}
