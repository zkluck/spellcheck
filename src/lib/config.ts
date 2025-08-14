/**
 * 应用配置，从环境变量中读取
 */
import { z } from 'zod';

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
 * 获取布尔类型环境变量，如果不存在则返回默认值
 * 真值: 1,true,yes,on（忽略大小写）
 */
function getEnvBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return defaultValue;
  return /^(1|true|yes|on)$/i.test(v);
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
    analyzeTimeoutMs: getEnvNumber('ANALYZE_TIMEOUT_MS', 60000),
    /**
     * 工作流配置：仅保留可读性强的 pipeline 字符串，自由配置顺序与次数。
     * 例如：WORKFLOW_PIPELINE="basic*2,reviewer,fluent*1"
     * 可用 agent：basic | fluent | reviewer；省略 *n 等同 *1。
     */
    workflow: ((): { pipeline: Array<{ agent: 'basic' | 'fluent' | 'reviewer'; runs: number }> } => {
      const raw = getEnv('WORKFLOW_PIPELINE', 'basic*1,fluent*1,reviewer*1');
      const parsed = parsePipelineEnv(raw);
      const PipelineEntrySchema = z.object({
        agent: z.enum(['basic', 'fluent', 'reviewer']),
        runs: z.number().int().positive(),
      });
      const PipelineSchema = z.array(PipelineEntrySchema).min(1);
      const safe = PipelineSchema.safeParse(parsed);
      if (safe.success) return { pipeline: safe.data };
      // 回退默认
      return {
        pipeline: [
          { agent: 'basic', runs: 1 },
          { agent: 'fluent', runs: 1 },
          { agent: 'reviewer', runs: 1 },
        ],
      };
    })(),
    /**
     * 合并阶段行为
     */
    merge: {
      /**
       * 是否在合并/去重时优先使用置信度（当可用时）。
       * 环境变量：MERGE_CONFIDENCE_FIRST（默认 true）
       */
      confidenceFirst: getEnvBool('MERGE_CONFIDENCE_FIRST', true),
    },
    /**
     * 各 Agent 的细粒度配置
     */
    agents: {
      basic: {
        /**
         * 置信度阈值（仅保留 >= 阈值），默认 0.9
         * 环境变量：BASIC_MIN_CONFIDENCE
         */
        minConfidence: getEnvNumber('BASIC_MIN_CONFIDENCE', 0.9),
        /**
         * 最大输出数量上限（返回前强制裁剪），默认 200
         * 环境变量：BASIC_MAX_OUTPUT
         */
        maxOutput: getEnvNumber('BASIC_MAX_OUTPUT', 200),
        /**
         * 是否强制仅保留索引“严格匹配”的项（metadata.locate === 'exact'）
         * 默认 true；环境变量：BASIC_REQUIRE_EXACT_INDEX
         */
        requireExactIndex: getEnvBool('BASIC_REQUIRE_EXACT_INDEX', true),
        /**
         * 是否允许在 toErrorItems() 中使用基于“唯一文本”的回退定位
         * 注意：当前实现即使关闭此项，仍可能启用“closest-by-hint”回退；最终会在返回阶段按 requireExactIndex 过滤
         * 默认 false；环境变量：BASIC_ALLOW_LOCATE_FALLBACK
         */
        allowLocateFallback: getEnvBool('BASIC_ALLOW_LOCATE_FALLBACK', false),
      },
      fluent: {
        /**
         * 置信度阈值（仅保留 >= 阈值），默认 0.9
         * 环境变量：FLUENT_MIN_CONFIDENCE
         */
        minConfidence: getEnvNumber('FLUENT_MIN_CONFIDENCE', 0.9),
        /**
         * 最大输出数量上限（返回前强制裁剪），默认 200
         * 环境变量：FLUENT_MAX_OUTPUT
         */
        maxOutput: getEnvNumber('FLUENT_MAX_OUTPUT', 200),
        /**
         * 是否强制仅保留索引“严格匹配”的项（metadata.locate === 'exact'）
         * 默认 true；环境变量：FLUENT_REQUIRE_EXACT_INDEX
         */
        requireExactIndex: getEnvBool('FLUENT_REQUIRE_EXACT_INDEX', true),
        /**
         * 是否允许在 toErrorItems() 中使用基于“唯一文本”的回退定位
         * 默认 false；环境变量：FLUENT_ALLOW_LOCATE_FALLBACK
         */
        allowLocateFallback: getEnvBool('FLUENT_ALLOW_LOCATE_FALLBACK', false),
      },
      reviewer: {
        /**
         * 置信度阈值（仅保留 >= 阈值），默认 0.9
         * 环境变量：REVIEWER_MIN_CONFIDENCE
         */
        minConfidence: getEnvNumber('REVIEWER_MIN_CONFIDENCE', 0.9),
        /**
         * 最大输出数量上限（返回前强制裁剪），默认 200
         * 环境变量：REVIEWER_MAX_OUTPUT
         */
        maxOutput: getEnvNumber('REVIEWER_MAX_OUTPUT', 200),
        /**
         * 是否强制仅保留索引“严格匹配”的项（metadata.locate === 'exact'）
         * 默认 true；环境变量：REVIEWER_REQUIRE_EXACT_INDEX
         */
        requireExactIndex: getEnvBool('REVIEWER_REQUIRE_EXACT_INDEX', true),
      },
    },
  },
  /**
   * 日志相关配置
   */
  logging: {
    /**
     * 是否允许在日志中输出示例内容（如文本片段、建议等）。
     * 默认: false
     * 环境变量: LOG_ENABLE_PAYLOAD
     */
    enablePayload: getEnvBool('LOG_ENABLE_PAYLOAD', false),
  },
};

/**
 * 获取布尔类型环境变量，如果不存在则返回默认值
 * 支持的真值: 1,true,yes,on（忽略大小写）·
 */
// 旧的布尔/开关工具已移除，不再使用

/**
 * 解析 WORKFLOW_PIPELINE 环境变量
 * 语法示例："basic*2, reviewer, fluent*1"
 */
function parsePipelineEnv(
  raw: string
): Array<{ agent: 'basic' | 'fluent' | 'reviewer'; runs: number }> {
  const items = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Array<{ agent: 'basic' | 'fluent' | 'reviewer'; runs: number }> =
    [];
  for (const it of items) {
    const m = it.match(/^(basic|fluent|reviewer)(?:\*(\d+))?$/i);
    if (!m) continue;
    const agent = m[1].toLowerCase() as 'basic' | 'fluent' | 'reviewer';
    const runs = Math.max(1, parseInt(m[2] ?? '1', 10) || 1);
    out.push({ agent, runs });
  }
  if (out.length === 0)
    return [
      { agent: 'basic', runs: 1 },
      { agent: 'fluent', runs: 1 },
      { agent: 'reviewer', runs: 1 },
    ];
  return out;
}
