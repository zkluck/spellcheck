/**
 * 应用配置，从环境变量中读取
 */

/**
 * 获取环境变量，如果不存在则返回默认值
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * 获取数字类型环境变量，如果不存在或无法解析则返回默认值
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 应用配置
 */
export const config = {
  /**
   * LangChain 相关配置
   */
  langchain: {
    /**
     * analyzeText 超时时间（毫秒）
     * 默认: 20000ms (20秒)
     * 环境变量: ANALYZE_TIMEOUT_MS
     */
    analyzeTimeoutMs: getEnvNumber('ANALYZE_TIMEOUT_MS', 20000),
    /**
     * 决定使用哪些 Agent 的工作流配置（可被环境变量覆盖）
     *
     * 环境变量：
     * - AGENT_BASIC:   true/false/on/off（默认 true）
     * - AGENT_FLUENT:  true/false/on/off（默认 true）
     * - AGENT_REVIEWER: on/off（默认 on）
     */
    workflow: {
      useBasic: getEnvBoolean('AGENT_BASIC', true),
      useFluent: getEnvBoolean('AGENT_FLUENT', true),
      reviewer: getEnvOnOff('AGENT_REVIEWER', 'on'),
      basicCalls: getEnvNumber('AGENT_BASIC_CALLS', 1),
      fluentCalls: getEnvNumber('AGENT_FLUENT_CALLS', 1),
      reviewerCalls: getEnvNumber('AGENT_REVIEWER_CALLS', 1),
    } as {
      useBasic: boolean;
      useFluent: boolean;
      reviewer: 'on' | 'off';
      basicCalls: number;
      fluentCalls: number;
      reviewerCalls: number;
    },
  },
  
};

/**
 * 获取布尔类型环境变量，如果不存在则返回默认值
 * 支持的真值: 1,true,yes,on（忽略大小写）
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(value);
}

/**
 * 获取 on/off 枚举环境变量
 */
function getEnvOnOff(key: string, defaultValue: 'on' | 'off'): 'on' | 'off' {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return String(value).toLowerCase() === 'off' ? 'off' : 'on';
}
