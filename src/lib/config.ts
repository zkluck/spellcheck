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
     * 默认: 8000ms (8秒)
     * 环境变量: ANALYZE_TIMEOUT_MS
     */
    analyzeTimeoutMs: getEnvNumber('ANALYZE_TIMEOUT_MS', 8000),
  },
  
  /**
   * API 相关配置
   */
  api: {
    /**
     * API 速率限制（每分钟请求数）
     * 默认: 60
     * 环境变量: API_RATE_LIMIT
     */
    rateLimit: getEnvNumber('API_RATE_LIMIT', 60),
  },
};
