import { logger } from '@/lib/logger';

export interface RetryOptions {
  retries: number; // 总重试次数（不含首次）
  factor?: number; // 指数退避因子
  minDelayMs?: number; // 最小延迟
  maxDelayMs?: number; // 最大延迟
  jitterRatio?: number; // 抖动比例（0-1）
}

export interface TimeoutOptions {
  timeoutMs?: number; // 总超时，含重试等待不含？此处仅对单次尝试的调用设置超时
}

export interface RateLimitOptions {
  capacity: number; // 桶容量
  refillPerSec: number; // 每秒令牌补充
}

export interface GuardOptions extends Partial<RetryOptions>, TimeoutOptions, Partial<RateLimitOptions> {
  operationName?: string;
  // 父级取消信号（例如来自 HTTP request.signal），将与超时信号合并
  parentSignal?: AbortSignal;
  // 需要记录到日志的输入字段（例如 prompt 变量、候选列表等）
  logFields?: unknown;
}

function readNumber(envName: string, fallback?: number): number | undefined {
  const v = process.env[envName];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// 简单 Token Bucket 限流器（进程内）
class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillPerSec: number;
  private lastRefillMs: number;

  constructor(opts: RateLimitOptions) {
    this.capacity = Math.max(1, opts.capacity);
    this.tokens = this.capacity;
    this.refillPerSec = Math.max(0, opts.refillPerSec);
    this.lastRefillMs = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefillMs) / 1000;
    if (elapsed <= 0) return;
    const add = this.refillPerSec * elapsed;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.lastRefillMs = now;
    }
  }

  acquire(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }
}

// 全局共享的令牌桶（可按需扩展为按 key 区分）
const defaultBucket = new TokenBucket({
  capacity: readNumber('RATE_LIMIT_CAPACITY', 5) ?? 5,
  refillPerSec: readNumber('RATE_LIMIT_REFILL_PER_SEC', 5) ?? 5,
});

// 自定义配置下的共享桶池：以 key 复用，避免每次新建导致限流失效
const sharedBuckets = new Map<string, TokenBucket>();
function getSharedBucket(key: string, capacity: number, refillPerSec: number): TokenBucket {
  let b = sharedBuckets.get(key);
  if (!b) {
    b = new TokenBucket({ capacity, refillPerSec });
    sharedBuckets.set(key, b);
  }
  return b;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function backoff(attempt: number, opts: Required<Pick<RetryOptions, 'factor' | 'minDelayMs' | 'maxDelayMs' | 'jitterRatio'>>): number {
  const { factor, minDelayMs, maxDelayMs, jitterRatio } = opts;
  const base = Math.min(maxDelayMs, minDelayMs * Math.pow(factor, attempt));
  if (jitterRatio <= 0) return base;
  const jitter = base * jitterRatio * Math.random();
  return Math.max(minDelayMs, Math.min(maxDelayMs, base - jitter / 2 + jitter));
}

function isAbortError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && 'name' in err && (err as any).name === 'AbortError');
}

function isRetryableError(err: unknown): boolean {
  // 5xx / 408 / 连接类错误
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  const code = (err as any)?.status ?? (err as any)?.statusCode;
  const sysCode = (err as any)?.code; // e.g., ETIMEDOUT, ENOTFOUND
  if (typeof code === 'number') {
    if (code === 408) return true;
    if (code >= 500 && code < 600) return true;
  }
  if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('ecconnreset') || msg.includes('socket hang up') || msg.includes('ehostunreach')) return true;
  if (sysCode && typeof sysCode === 'string') {
    const sc = sysCode.toUpperCase();
    if (['ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNREFUSED'].includes(sc)) return true;
  }
  return false;
}

// 将任意输入裁剪为适合日志的结构，避免过大或循环
function makeSafeForLog(value: unknown, depth = 0): unknown {
  const MAX_STR = 2000; // 单字段最大字符串长度
  const MAX_ARR = 50;   // 数组最多记录前 N 项
  const MAX_OBJ_KEYS = 50; // 对象最多记录前 N 个键
  const MAX_DEPTH = 4;  // 最大递归深度

  if (depth >= MAX_DEPTH) return '…';

  if (typeof value === 'string') {
    return value.length > MAX_STR ? value.slice(0, MAX_STR) + `…(truncated ${value.length - MAX_STR})` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value as any;
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARR).map((v) => makeSafeForLog(v, depth + 1));
    if (value.length > MAX_ARR) arr.push(`…(+${value.length - MAX_ARR} more)`);
    return arr;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    try {
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).slice(0, MAX_OBJ_KEYS);
      for (const k of keys) {
        out[k] = makeSafeForLog(rec[k], depth + 1);
      }
      const allKeys = Object.keys(rec);
      if (allKeys.length > keys.length) {
        out['…extraKeys'] = `+${allKeys.length - keys.length} keys`;
      }
    } catch {
      return String(value);
    }
    return out;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  (err as any).name = 'AbortError';
  return err;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs?: number, parentSignal?: AbortSignal): Promise<T> {
  const ac = new AbortController();
  let parentListener: (() => void) | null = null;

  // 若父信号已中止，直接抛出 AbortError，避免无谓调用
  if (parentSignal?.aborted) {
    throw createAbortError();
  }

  // 合并父级取消
  if (parentSignal) {
    parentListener = () => ac.abort();
    parentSignal.addEventListener('abort', parentListener);
  }

  // 超时取消
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ac.abort(), timeoutMs);
  }

  try {
    return await fn(ac.signal);
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal && parentListener) parentSignal.removeEventListener('abort', parentListener);
  }
}

export async function withRetry<T>(
  op: () => Promise<T>,
  options: RetryOptions & { operationName?: string }
): Promise<T> {
  const {
    retries,
    factor = 2,
    minDelayMs = 200,
    maxDelayMs = 4000,
    jitterRatio = 0.2,
    operationName = 'operation',
  } = options;

  let attempt = 0;
  for (;;) {
    try {
      if (attempt > 0) {
        logger.info('retry.attempt', { operation: operationName, attempt });
      }
      const result = await op();
      if (attempt > 0) {
        logger.info('retry.success', { operation: operationName, attempts: attempt + 1 });
      }
      return result;
    } catch (err) {
      const isAbort = isAbortError(err);
      const canRetry = !isAbort && isRetryableError(err);
      logger.warn('retry.error', {
        operation: operationName,
        attempt,
        error: String((err as any)?.message ?? err),
        isAbort,
        canRetry,
      });
      if (!canRetry || attempt >= retries) {
        logger.error('retry.giveup', { operation: operationName, attempts: attempt + 1 });
        throw err;
      }
      const delay = backoff(attempt, { factor, minDelayMs, maxDelayMs, jitterRatio });
      await sleep(delay);
      attempt += 1;
    }
  }
}

export async function guardLLMInvoke<T>(
  invoker: (signal?: AbortSignal) => Promise<T>,
  opts: GuardOptions = {}
): Promise<T> {
  const operation = opts.operationName ?? 'llm.invoke';

  // 限流：若获取不到令牌，阻塞等待到下一个补充周期（简单等待）
  if (!(opts.capacity && opts.refillPerSec)) {
    // 使用默认桶
    if (!defaultBucket.acquire(1)) {
      const waitMs = 1000 / (readNumber('RATE_LIMIT_REFILL_PER_SEC', 5) ?? 5);
      logger.warn('ratelimit.wait', { operation, waitMs });
      await sleep(waitMs);
    }
  } else {
    const cap = Math.max(1, opts.capacity);
    const ref = Math.max(0, opts.refillPerSec);
    const key = `${operation}:${cap}:${ref}`;
    const bucket = getSharedBucket(key, cap, ref);
    if (!bucket.acquire(1)) {
      const waitMs = ref > 0 ? Math.ceil(1000 / ref) : 1000;
      logger.warn('ratelimit.wait', { operation, waitMs });
      await sleep(waitMs);
    }
  }

  const retryOpts: RetryOptions = {
    retries: typeof opts.retries === 'number' ? opts.retries : readNumber('LLM_RETRIES', 2) ?? 2,
    factor: opts.factor ?? 2,
    minDelayMs: opts.minDelayMs ?? 200,
    maxDelayMs: opts.maxDelayMs ?? 4000,
    jitterRatio: opts.jitterRatio ?? 0.2,
  };
  const timeoutMs = opts.timeoutMs ?? readNumber('LLM_TIMEOUT_MS') ?? undefined;

  logger.debug('llm.invoke.start', { operation, timeoutMs, retryOpts });
  if (typeof opts.logFields !== 'undefined') {
    try {
      const fields = makeSafeForLog(opts.logFields);
      logger.info('llm.invoke.input', { operation, fields });
    } catch (e) {
      logger.warn('llm.invoke.input_log_failed', { operation, error: String((e as any)?.message ?? e) });
    }
  }
  const result = await withRetry(() => withTimeout((signal) => invoker(signal), timeoutMs, opts.parentSignal), {
    ...retryOpts,
    operationName: operation,
  });
  logger.debug('llm.invoke.end', { operation });
  return result;
}
