 import { analyzeText } from '@/lib/langchain';
import { AnalyzeRequestSchema } from '@/types/schemas';
import { ErrorItemSchema } from '@/types/error';
import type { ErrorItem } from '@/types/error';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';

// 明确使用 Node.js 运行时，确保 SSE 与服务端能力可用
export const runtime = 'nodejs';

// 出参安全：对错误项进行二次校验/清洗
function sanitizeErrors(raw: unknown) {
  if (!Array.isArray(raw)) return [] as ErrorItem[];
  const out: ErrorItem[] = [];
  for (const it of raw) {
    const r = ErrorItemSchema.safeParse(it);
    if (r.success) out.push(r.data);
  }
  return out;
}

function getIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  if (xr) return xr.trim();
  return 'unknown';
}
 

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') || randomUUID();
  try {
    const startedAtAll = Date.now();
    const ip = getIp(request);
    const log = (event: string, details: Record<string, any> = {}) => {
      try {
        logger.info(`api.check.${event}`, { reqId: requestId, ip, ...details });
      } catch {}
    };
    log('request.received', { method: 'POST', path: '/api/check' });
    // 记录当前 pipeline 配置，便于复现
    try { log('pipeline', { pipeline: (config.langchain.workflow as any)?.pipeline }); } catch {}
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
      if (e2eScenario) log('e2e.scenario.detected', { scenario: e2eScenario });


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
    // 入站限流逻辑已移除：不再对外实现限流，若需控制吞吐请改为内部排队/降级。

    // 解析请求体
    const reqJson = await request.json();
    const parsed = AnalyzeRequestSchema.safeParse(reqJson);

    if (!parsed.success) {
      log('request.bad_request', { zod: parsed.error.flatten() });
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
      log('json.start');
      const errors = await analyzeText(text, options, collectCallback, request.signal, { reqId: requestId });
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
      log('json.done', { elapsedMs, warnings: warnings.length, errorCount: sanitized.length });
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
              try { log('sse.chunk', { agent: obj.agent, errorCount: Array.isArray(obj.errors) ? obj.errors.length : 0 }); } catch {}
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
          log('sse.start');
          // 调用核心分析函数，并传入流式回调
          const finalResult = await analyzeText(text, options, streamCallback, request.signal, { reqId: requestId });
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
          log('sse.final', { elapsedMs, errorCount: Array.isArray(finalData.errors) ? finalData.errors.length : 0 });
        } catch (error) {
          const err: any = error;
          const message = err?.message || String(err);
          const aborted = (request as any)?.signal?.aborted === true || err?.name === 'AbortError';
          const code = aborted ? 'aborted' : 'internal';
          safeEnqueue({ type: 'error', code, message, requestId });
          log('sse.error', { code, message });
        } finally {
          clearInterval(keepAlive);
          request.signal?.removeEventListener?.('abort', abortHandler as any);
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
          log('sse.close', { aborted: (request as any)?.signal?.aborted === true, totalElapsedMs: Date.now() - startedAtAll });
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
    try { logger.error('api.check.unhandled_error', { reqId: requestId, error: (error as any)?.message }); } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
  }
}
