 import { analyzeText } from '@/lib/langchain';
 import { z } from 'zod';
 import { ErrorItemSchema } from '@/types/error';
import { config } from '@/lib/config';
import { randomUUID } from 'crypto';

// 明确使用 Node.js 运行时，确保 SSE 与服务端能力可用
export const runtime = 'nodejs';

// 定义请求体和选项的 Zod Schema
const OptionsSchema = z.object({
  enabledTypes: z.array(z.enum(['grammar', 'spelling', 'punctuation', 'fluency'])).nonempty(),
  // ReviewerAgent 开关（默认 on）。可选传入以覆盖默认值
  reviewer: z.enum(['on', 'off']).optional(),
});
const BodySchema = z.object({
  text: z.string().min(1, 'text 不能为空'),
  options: OptionsSchema,
});

// 出参安全：对错误项进行二次校验/清洗
const ErrorsArraySchema = z.array(ErrorItemSchema);
function sanitizeErrors(raw: unknown) {
  if (!Array.isArray(raw)) return [] as z.infer<typeof ErrorItemSchema>[];
  const out: z.infer<typeof ErrorItemSchema>[] = [];
  for (const it of raw) {
    const r = ErrorItemSchema.safeParse(it);
    if (r.success) out.push(r.data);
  }
  return out;
}

// 简易入站限流（进程内、按 IP 令牌桶）。生产可替换为持久/分布式实现
class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillPerSec: number;
  private lastRefill: number;
  constructor(capacity: number, refillPerSec: number) {
    this.capacity = Math.max(1, capacity);
    this.tokens = this.capacity;
    this.refillPerSec = Math.max(0, refillPerSec);
    this.lastRefill = Date.now();
  }
  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    const add = this.refillPerSec * elapsed;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.lastRefill = now;
    }
  }
  acquire(n = 1) {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}
const buckets = new Map<string, TokenBucket>();
function getIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  if (xr) return xr.trim();
  return 'unknown';
}
function getBucketFor(request: Request): TokenBucket {
  const ip = getIp(request);
  const key = ip || 'unknown';
  const perMinute = config.api.rateLimit; // 每分钟请求数
  const refill = perMinute / 60; // 每秒补充
  let b = buckets.get(key);
  if (!b) {
    b = new TokenBucket(perMinute, refill);
    buckets.set(key, b);
  }
  return b;
}

export async function POST(request: Request) {
  try {
    const requestId = request.headers.get('x-request-id') || randomUUID();
    const startedAtAll = Date.now();
    const ip = getIp(request);
    const log = (event: string, details: Record<string, any> = {}) => {
      try {
        console.info(JSON.stringify({ ts: new Date().toISOString(), event, requestId, ip, ...details }));
      } catch {}
    };
    log('request_received', { method: 'POST', path: '/api/check' });
    // E2E 测试注入：仅当设置 E2E_ENABLE=1 时，允许通过自定义头控制模拟场景
    // 为避免 Response body 处理问题，E2E 场景优先处理，不预先消费请求体
    const e2eEnabled = process.env.E2E_ENABLE === '1';
    if (e2eEnabled) {
      // 支持 Header 或 Cookie 注入场景：x-e2e-scenario / cookie e2e_scenario
      const cookie = request.headers.get('cookie') || '';
      const cookieMap = new Map<string, string>();
      if (cookie) {
        cookie.split(';').forEach(kv => {
          const idx = kv.indexOf('=');
          if (idx > -1) {
            const k = kv.slice(0, idx).trim();
            const v = kv.slice(idx + 1).trim();
            cookieMap.set(k, decodeURIComponent(v));
          }
        });
      }
      const e2eScenario = request.headers.get('x-e2e-scenario') || cookieMap.get('e2e_scenario') || '';
      const e2eId = request.headers.get('x-e2e-id') || cookieMap.get('e2e_id') || requestId;
      const store = (globalThis as any).__E2E_COUNTERS__ || new Map<string, number>();
      (globalThis as any).__E2E_COUNTERS__ = store;
      const hit = (k: string) => { const v = store.get(k) || 0; store.set(k, v + 1); return v + 1; };



      if (e2eScenario === '5xx-then-ok') {
        const n = hit(`5xx-${e2eId}`);
        if (n === 1) {
          log('e2e_5xx_first');
          return new Response(JSON.stringify({ error: 'Service Unavailable (e2e)' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'X-E2E-Stage': 'first', 'X-E2E-Scenario': e2eScenario },
          });
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(':ready\n\n'));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'final', errors: [], meta: { elapsedMs: 5, enabledTypes: ['grammar'] } })}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Request-Id': requestId,
            'X-E2E-Stage': 'ok',
            'X-E2E-Scenario': e2eScenario,
          },
        });
      }

      // 其他 E2E 场景需要消费请求体，因为它们返回流响应
      if (e2eScenario && ['sse-garbage-then-final', 'long-stream', 'idle-no-final'].includes(e2eScenario)) {
        try {
          await request.json();
        } catch {
          // 忽略请求体解析错误，E2E 场景不依赖具体内容
        }
      }

      if (e2eScenario === 'sse-garbage-then-final') {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(':ready\n\n'));
            controller.enqueue(encoder.encode('data: notjson\n\n'));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'final', errors: [], meta: { elapsedMs: 5, enabledTypes: ['grammar'] } })}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Request-Id': requestId,
            'X-E2E-Stage': 'ok',
            'X-E2E-Scenario': e2eScenario,
          },
        });
      }

      // 长时间保持连接，延迟发送数据，不主动 final，便于测试前端取消（用户点击"取消"）
      if (e2eScenario === 'long-stream') {
        const encoder = new TextEncoder();
        let t1: ReturnType<typeof setTimeout> | null = null;
        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            const onAbort = () => {
              if (!closed) {
                closed = true;
                try { controller.close(); } catch {}
              }
            };
            request.signal.addEventListener('abort', onAbort, { once: true });
            // 先发送 ready
            controller.enqueue(encoder.encode(':ready\n\n'));
            // 模拟一段时间后才发送一个 chunk，给前端留出取消的窗口
            t1 = setTimeout(() => {
              if (closed) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', agent: 'basic', errors: [] })}\n\n`));
            }, 3000);
            // 不发送 final，让前端可随时取消
          },
          cancel() {
            try { if (t1) clearTimeout(t1); } catch {}
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Request-Id': requestId,
            'X-E2E-Stage': 'ok',
            'X-E2E-Scenario': e2eScenario,
          },
        });
      }

      // 仅发送 ready 后保持空闲，不发送任何数据与 final，用于触发前端 idle 重试与总时长上限
      if (e2eScenario === 'idle-no-final') {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            const onAbort = () => {
              if (!closed) {
                closed = true;
                try { controller.close(); } catch {}
              }
            };
            request.signal.addEventListener('abort', onAbort, { once: true });
            controller.enqueue(encoder.encode(':ready\n\n'));
            // 不再发送任何数据，保持连接由前端 idle watchdog 来判断与重试
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Request-Id': requestId,
            'X-E2E-Stage': 'ok',
            'X-E2E-Scenario': e2eScenario,
          },
        });
      }
    }
    // 入站限流（过载时直接 429）
    const bucket = getBucketFor(request);
    if (!bucket.acquire(1)) {
      log('rate_limited');
      return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试。' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '1', 'X-Request-Id': requestId },
      });
    }

    // 解析请求体
    const reqJson = await request.json();
    const parsed = BodySchema.safeParse(reqJson);

    if (!parsed.success) {
      log('bad_request', { zod: parsed.error.flatten() });
      return new Response(JSON.stringify({ error: '请求参数不合法', details: parsed.error.flatten() }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      });
    }

    const { text, options } = parsed.data;
    const accept = request.headers.get('accept') || '';
    const wantsSSE = accept.includes('text/event-stream');
    const startedAt = Date.now();

    if (!wantsSSE) {
      // 非流式：直接返回 JSON，兼容测试与简单客户端
      // 但仍然通过回调收集 Reviewer 的警告信息，置于 meta.warnings
      const warnings: string[] = [];
      const collectCallback = (chunk: any) => {
        if (chunk?.agent === 'reviewer' && chunk?.response?.error) {
          warnings.push(String(chunk.response.error));
        }
      };
      log('json_mode_start');
      const errors = await analyzeText(text, options, collectCallback, request.signal);
      const sanitized = sanitizeErrors(errors);
      const elapsedMs = Date.now() - startedAt;
      const body = {
        errors: sanitized,
        meta: {
          elapsedMs,
          enabledTypes: options.enabledTypes,
          ...(warnings.length ? { warnings } : {}),
        },
      };
      log('json_mode_done', { elapsedMs, warnings: warnings.length, errorCount: sanitized.length });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
      });
    }

    // 流式 SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        // 监听客户端断开/请求中止
        const abortHandler = () => {
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
        };
        (request as any).signal?.addEventListener?.('abort', abortHandler);

        const safeEnqueue = (obj: any) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            if (obj?.type === 'chunk') {
              try { log('sse_chunk', { agent: obj.agent, errorCount: Array.isArray(obj.errors) ? obj.errors.length : 0 }); } catch {}
            }
          } catch {
            // 如果写入失败，视为已关闭，忽略后续写入
            isClosed = true;
          }
        };
        const sendComment = (text: string) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`:${text}\n\n`));
          } catch {
            isClosed = true;
          }
        };
        // 预热：发送首个注释，帮助某些中间层尽快建立流
        sendComment('ready');
        // 保活心跳，避免长链接被中间层过早断开
        const keepAlive = setInterval(() => sendComment('keep-alive'), 15000);
        // 定义流式回调
        const streamCallback = (chunk: any) => {
          const { agent, response } = chunk;
          // 我们只流式传输每个 agent 的初步结果
          const data = {
            type: 'chunk',
            agent,
            errors: sanitizeErrors(response?.result),
          };
          safeEnqueue(data);
          if (response?.error) {
            safeEnqueue({ type: 'warning', agent, message: response.error });
          }
        };

        try {
          const startedAt = Date.now();
          log('sse_start');
          // 调用核心分析函数，并传入流式回调
          const finalResult = await analyzeText(text, options, streamCallback, request.signal);
          const elapsedMs = Date.now() - startedAt;

          // 在流的末尾发送最终的合并结果和元数据
          const finalData = {
            type: 'final',
            errors: sanitizeErrors(finalResult),
            meta: {
              elapsedMs,
              enabledTypes: options.enabledTypes,
            },
          };
          safeEnqueue(finalData);
          log('sse_final', { elapsedMs, errorCount: Array.isArray(finalData.errors) ? finalData.errors.length : 0 });
        } catch (error) {
          const errorData = { type: 'error', message: (error as Error).message };
          safeEnqueue(errorData);
          log('sse_error', { message: (error as Error)?.message });
        } finally {
          clearInterval(keepAlive);
          request.signal?.removeEventListener?.('abort', abortHandler as any);
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
          log('sse_close', { aborted: (request as any)?.signal?.aborted === true, totalElapsedMs: Date.now() - startedAtAll });
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId,
      },
    });

  } catch (error) {
    const requestId = randomUUID();
    try { console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'unhandled_error', requestId, error: (error as any)?.message })); } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
  }
}
