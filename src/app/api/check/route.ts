// 切换为基于“角色流水线执行器”的实现
import { AnalyzeRequestSchema } from '@/types/schemas';
import { ErrorItemSchema } from '@/types/error';
import type { ErrorItem } from '@/types/error';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { config } from '@/lib/config';
import { runPipeline } from '@/lib/roles/executor';
import { registerBuiltinRoles } from '@/lib/roles/register-builtin';

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

// —— 本地响应类型，确保不使用 any ——
type ReviewerStatus = 'skipped' | 'error' | 'empty' | 'ok';
interface DecisionsCount { accepted: number; rejected: number; modified: number }
interface AnalyzeResponseMeta {
  elapsedMs: number;
  reviewer: {
    ran: boolean;
    status: ReviewerStatus;
    counts: DecisionsCount;
    fallbackUsed: boolean;
    error?: string;
  };
  warnings?: string[];
}
interface AnalyzeResponse {
  errors: ErrorItem[];
  patchedText?: string;
  meta: AnalyzeResponseMeta;
}
interface SSEFinalEvent {
  type: 'final';
  errors: ErrorItem[];
  meta: AnalyzeResponseMeta;
  patchedText?: string;
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
    const log = (event: string, details: Record<string, unknown> = {}) => {
      try {
        logger.info(`api.check.${event}`, { reqId: requestId, ip, ...details });
      } catch {}
    };
    log('request.received', { method: 'POST', path: '/api/check' });
    // 记录当前 pipeline 配置，便于复现
    try { log('pipeline', { pipeline: config.langchain.workflow.pipeline }); } catch {}
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'final', errors: [], meta: { elapsedMs: 5 } })}\n\n`));
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
      // 非流式：运行角色流水线并收集最终结果（支持 Reviewer 失败/为空时回退 Basic）
      registerBuiltinRoles();
      const warnings: string[] = [];
      log('json.start');
      type ReqPipelineEntry = { id: string; runs?: number; modelName?: string };
      const roleEntries = (options.pipeline && options.pipeline.length
        ? options.pipeline.map((p: ReqPipelineEntry) => ({ id: p.id, runs: p.runs ?? 1, modelName: p.modelName }))
        : (config.langchain.workflow.pipeline || []).map((p: { agent: 'basic'; runs: number }) => ({ id: p.agent, runs: p.runs }))
      );
      // 记录本次请求实际采用的 pipeline 来源与内容
      try {
        const source = options.pipeline && options.pipeline.length ? 'request' : 'config';
        log('pipeline.selected', { source, roles: roleEntries });
      } catch {}

      let basicItems: ErrorItem[] = [];
      let reviewerItems: ErrorItem[] = [];
      let reviewerRan = false;
      let reviewerError: string | undefined;
      let decisionsStat = { accepted: 0, rejected: 0, modified: 0 };
      // 记录最后一次角色完成后的全文（修复后）
      let finalPatchedText: string | undefined;

      // 建立总超时与可取消控制
      const controller = new AbortController();
      const onAbort = (_ev: Event) => {
        try { controller.abort(); } catch {}
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, config.langchain.analyzeTimeoutMs);

      try {
        for await (const ev of runPipeline({
          roles: roleEntries,
          input: { text },
          signal: controller.signal,
          metadata: {},
        })) {
          if (ev.stage === 'final') {
            const payload = (ev.payload ?? {}) as Record<string, unknown>;
            const itemsRaw: unknown = (payload as { items?: unknown }).items;
            const items = Array.isArray(itemsRaw) ? itemsRaw : [];
            const sanitized = sanitizeErrors(items);
            if (typeof payload.patchedText === 'string') {
              finalPatchedText = payload.patchedText;
            }
            if (ev.roleId === 'basic') {
              basicItems = sanitized;
            } else if (ev.roleId === 'reviewer') {
              reviewerRan = true;
              reviewerItems = sanitized;
              const decisions = Array.isArray((payload as { decisions?: unknown }).decisions)
                ? ((payload as { decisions?: unknown }).decisions as unknown[])
                : [];
              if (decisions.length) {
                const stat: { accepted: number; rejected: number; modified: number } = { accepted: 0, rejected: 0, modified: 0 };
                for (const d of decisions as Array<{ status?: unknown }>) {
                  const raw = (d?.status ?? '').toString().toLowerCase();
                  const s = String(raw);
                  if (s === 'accept') stat.accepted++;
                  else if (s === 'reject') stat.rejected++;
                  else if (s === 'modify' || s === 'revise') stat.modified++;
                }
                decisionsStat = stat;
              }
              const errMsg = (payload as { error?: unknown }).error;
              if (typeof errMsg === 'string') reviewerError = errMsg;
            }
          } else if (ev.stage === 'error') {
            warnings.push(`${ev.roleId}:${ev.error}`);
            if (ev.roleId === 'reviewer') {
              reviewerRan = true;
              reviewerError = String(ev.error || 'unknown_error');
            }
          }
        }
      } catch (e) {
        const abortedByClient = request.signal.aborted === true;
        const abortedByTimeout = controller.signal.aborted === true && !abortedByClient;
        const msg = (e instanceof Error ? e.message : String(e));
        log('json.error', { message: msg, abortedByClient, abortedByTimeout });
        if (abortedByClient || abortedByTimeout) {
          const status = abortedByClient ? 499 : 504;
          const body = { error: abortedByClient ? 'client_aborted' : 'timeout' };
          clearTimeout(timeout);
          request.signal.removeEventListener('abort', onAbort);
          return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
          });
        }
        throw e;
      }
      finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', onAbort);
      }

      const elapsedMs = Date.now() - startedAt;
      const reviewerStatus = !reviewerRan
        ? 'skipped'
        : reviewerError
        ? 'error'
        : reviewerItems.length === 0
        ? 'empty'
        : 'ok';
      const fallbackUsed = reviewerRan && reviewerItems.length === 0 && basicItems.length > 0;
      const finalErrors = reviewerItems.length > 0 ? reviewerItems : basicItems;

      const body: AnalyzeResponse = {
        errors: finalErrors,
        ...(config.langchain.agents.basic.returnPatchedText ? { patchedText: finalPatchedText ?? text } : {}),
        meta: {
          elapsedMs,
          reviewer: {
            ran: reviewerRan,
            status: reviewerStatus as ReviewerStatus,
            counts: decisionsStat,
            fallbackUsed,
            ...(reviewerError ? { error: reviewerError } : {}),
          },
          ...(warnings.length ? { warnings } : {}),
        },
      };
      log('json.done', { elapsedMs, warnings: warnings.length, errorCount: body.errors.length, reviewer: body.meta.reviewer });
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
        const abortHandler = (_ev: Event) => {
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
        };
        request.signal.addEventListener('abort', abortHandler);

        const safeEnqueue = (obj: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            if (typeof obj === 'object' && obj !== null && (obj as { type?: unknown }).type === 'chunk') {
              const agent = (obj as { agent?: unknown }).agent;
              const errorsField = (obj as { errors?: unknown }).errors;
              const errorCount = Array.isArray(errorsField) ? errorsField.length : 0;
              try { log('sse.chunk', { agent, errorCount }); } catch {}
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
        try {
          const startedAt = Date.now();
          log('sse.start');
          registerBuiltinRoles();
          type ReqPipelineEntry = { id: string; runs?: number; modelName?: string };
          const roleEntries = (options.pipeline && options.pipeline.length
            ? options.pipeline.map((p: ReqPipelineEntry) => ({ id: p.id, runs: p.runs ?? 1, modelName: p.modelName }))
            : (config.langchain.workflow.pipeline || []).map((p: { agent: 'basic'; runs: number }) => ({ id: p.agent, runs: p.runs }))
          );
          // 记录本次 SSE 请求实际采用的 pipeline 来源与内容
          try {
            const source = options.pipeline && options.pipeline.length ? 'request' : 'config';
            log('pipeline.selected', { source, roles: roleEntries });
          } catch {}
          let lastItems: ErrorItem[] = [];
          let lastPatchedText: string | undefined;
          // 跟踪 basic / reviewer 结果用于最终回退
          let basicItems: ErrorItem[] = [];
          let reviewerItems: ErrorItem[] = [];
          let reviewerRan = false;
          let reviewerError: string | undefined;
          let decisionsStat = { accepted: 0, rejected: 0, modified: 0 };
          // 角色执行信号：挂接客户端中断与总超时
          const roleAbort = new AbortController();
          const roleAbortOnReqAbort = (_ev: Event) => { try { roleAbort.abort(); } catch {} };
          request.signal.addEventListener('abort', roleAbortOnReqAbort, { once: true });
          const roleTimeout = setTimeout(() => { try { roleAbort.abort(); } catch {} }, config.langchain.analyzeTimeoutMs);

          for await (const ev of runPipeline({
            roles: roleEntries,
            input: { text },
            signal: roleAbort.signal,
            metadata: {},
          })) {
            if (ev.stage === 'start') {
              // 可选：发送开始事件（当前协议不要求）
            } else if (ev.stage === 'chunk') {
              const payloadUnknown = ev.payload as unknown;
              let items: unknown[] = [];
              if (Array.isArray(payloadUnknown)) {
                items = payloadUnknown;
              } else if (payloadUnknown && typeof payloadUnknown === 'object' && Array.isArray((payloadUnknown as { items?: unknown }).items)) {
                items = ((payloadUnknown as { items?: unknown }).items as unknown[]) || [];
              }
              // 附带步骤索引（若执行器提供），用于前端聚合分组
              const runIndex: number | undefined = ev.runIndex;
              const data = { type: 'chunk', agent: ev.roleId, errors: sanitizeErrors(items), ...(typeof runIndex === 'number' ? { runIndex } : {}) };
              safeEnqueue(data);
            } else if (ev.stage === 'final') {
              const payload = (ev.payload ?? {}) as Record<string, unknown>;
              const itemsRaw: unknown = (payload as { items?: unknown }).items;
              const items = Array.isArray(itemsRaw) ? itemsRaw : [];
              lastItems = sanitizeErrors(items);
              if (typeof payload.patchedText === 'string') {
                lastPatchedText = payload.patchedText;
              }
              // 跟踪 basic/reviewer
              if (ev.roleId === 'basic') {
                basicItems = lastItems;
              } else if (ev.roleId === 'reviewer') {
                reviewerRan = true;
                reviewerItems = lastItems;
                const decisions = Array.isArray((payload as { decisions?: unknown }).decisions)
                  ? ((payload as { decisions?: unknown }).decisions as unknown[])
                  : [];
                if (decisions.length) {
                  const stat: { accepted: number; rejected: number; modified: number } = { accepted: 0, rejected: 0, modified: 0 };
                  for (const d of decisions as Array<{ status?: unknown }>) {
                    const raw = (d?.status ?? '').toString().toLowerCase();
                    const s = String(raw);
                    if (s === 'accept') stat.accepted++;
                    else if (s === 'reject') stat.rejected++;
                    else if (s === 'modify' || s === 'revise') stat.modified++;
                  }
                  decisionsStat = stat;
                }
                const errMsg = (payload as { error?: unknown }).error;
                if (typeof errMsg === 'string') reviewerError = errMsg;
              }
              // 向后兼容：每个角色最终产物也以 chunk 形式发送，带 runIndex 标记
              const runIndex: number | undefined = ev.runIndex;
              const data = { type: 'chunk', agent: ev.roleId, errors: lastItems, ...(typeof runIndex === 'number' ? { runIndex, isFinalOfRun: true } : { isFinalOfRun: true }) } as { type: 'chunk'; agent: string; errors: ErrorItem[]; runIndex?: number; isFinalOfRun: true };
              safeEnqueue(data);
            } else if (ev.stage === 'error') {
              safeEnqueue({ type: 'warning', agent: ev.roleId, message: ev.error });
              if (ev.roleId === 'reviewer') {
                reviewerRan = true;
                reviewerError = String(ev.error || 'unknown_error');
              }
            }
          }
          clearTimeout(roleTimeout);
          request.signal.removeEventListener('abort', roleAbortOnReqAbort);

          const elapsedMs = Date.now() - startedAt;
          const reviewerStatus = !reviewerRan
            ? 'skipped'
            : reviewerError
            ? 'error'
            : reviewerItems.length === 0
            ? 'empty'
            : 'ok';
          const fallbackUsed = reviewerRan && reviewerItems.length === 0 && basicItems.length > 0;
          const finalErrors = reviewerItems.length > 0 ? reviewerItems : basicItems;
          const finalData: SSEFinalEvent = {
            type: 'final',
            errors: finalErrors,
            meta: {
              elapsedMs,
              reviewer: {
                ran: reviewerRan,
                status: reviewerStatus as ReviewerStatus,
                counts: decisionsStat,
                fallbackUsed,
                ...(reviewerError ? { error: reviewerError } : {}),
              },
            },
            ...(config.langchain.agents.basic.returnPatchedText ? { patchedText: lastPatchedText ?? text } : {}),
          };
          safeEnqueue(finalData);
          log('sse.final', { elapsedMs, errorCount: Array.isArray(finalData.errors) ? finalData.errors.length : 0, reviewer: finalData.meta.reviewer });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const aborted = request.signal.aborted === true || (error instanceof Error && (error as Error).name === 'AbortError');
          const code = aborted ? 'aborted' : 'internal';
          safeEnqueue({ type: 'error', code, message, requestId });
          log('sse.error', { code, message });
        } finally {
          clearInterval(keepAlive);
          request.signal.removeEventListener('abort', abortHandler);
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
          log('sse.close', { aborted: request.signal.aborted === true, totalElapsedMs: Date.now() - startedAtAll });
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
  } catch (error: unknown) {
    try { logger.error('api.check.unhandled_error', { reqId: requestId, error: error instanceof Error ? error.message : String(error) }); } catch {}
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
  }
}
