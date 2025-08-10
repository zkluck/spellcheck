/**
 * 前端可调参数（使用 NEXT_PUBLIC_ 环境变量）
 */

const num = (v: string | undefined, d: number) => {
  if (!v) return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const feConfig = {
  // 最大重试次数
  maxRetries: num(process.env.NEXT_PUBLIC_MAX_RETRIES, 3),
  // SSE 空闲超时（毫秒）
  idleMs: num(process.env.NEXT_PUBLIC_SSE_IDLE_MS, 20000),
  // 重试基础延迟（毫秒）
  baseDelayMs: num(process.env.NEXT_PUBLIC_BASE_DELAY_MS, 600),
  // 总时长上限（毫秒），超出后终止
  totalTimeoutMs: num(process.env.NEXT_PUBLIC_TOTAL_TIMEOUT_MS, 60000),
  // 退避范围（毫秒）
  backoffMinMs: num(process.env.NEXT_PUBLIC_BACKOFF_MIN_MS, 400),
  backoffMaxMs: num(process.env.NEXT_PUBLIC_BACKOFF_MAX_MS, 8000),
};
