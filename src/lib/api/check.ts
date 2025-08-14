import { feConfig } from '@/lib/feConfig';
import type { ErrorItem } from '@/types/error';

export type EnabledTypesOption = {
  enabledTypes: string[];
};

export type RetryReason = 'http-5xx' | 'network' | 'idle' | 'eof-no-final' | 'unknown';

export type SseCheckCallbacks = {
  onChunk?: (errors: ErrorItem[]) => void;
  onFinal?: (errors: ErrorItem[], meta?: any) => void;
  onError?: (message: string, code?: string, requestId?: string) => void;
  onRetry?: (reason: RetryReason, waitMs: number, attempt: number, maxRetries: number) => void;
};

export type SseCheckOutcome = 'success' | 'terminal';

function calcBackoffMs(
  attempt: number,
  reason?: RetryReason,
  baseDelay = feConfig.baseDelayMs
) {
  let base = baseDelay;
  if (reason === 'http-5xx') base = 800;
  else if (reason === 'network') base = 700;
  else if (reason === 'idle') base = 600;
  else if (reason === 'eof-no-final') base = 650;
  const raw = base * Math.pow(2, attempt - 1);
  const jitter = 0.2 + Math.random() * 0.3; // 20%-50%
  const withJitter = raw * (1 + jitter);
  return Math.max(feConfig.backoffMinMs, Math.min(feConfig.backoffMaxMs, Math.floor(withJitter)));
}

function pickCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookie = document.cookie || '';
  const m = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(id);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if ((signal as any)?.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  });
}

export async function sseCheck(
  text: string,
  options: EnabledTypesOption,
  controller: AbortController,
  cb: SseCheckCallbacks,
  maxRetries = feConfig.maxRetries,
  idleMs = feConfig.idleMs,
  totalTimeoutMs = feConfig.totalTimeoutMs
): Promise<SseCheckOutcome> {
  const totalDeadline = Date.now() + totalTimeoutMs;
  const remaining = () => Math.max(0, totalDeadline - Date.now());

  const totalTimeoutId = setTimeout(() => {
    try {
      controller.abort(new DOMException('Total timeout exceeded', 'TimeoutError'));
    } catch {}
  }, totalTimeoutMs);

  const attemptOnce = async (attempt: number): Promise<'success' | 'terminal' | { retry: RetryReason }> => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      // 透传 E2E 场景，便于自动化测试（仅本地/测试环境使用）
      const e2eScenario = pickCookie('e2e_scenario');
      const e2eId = pickCookie('e2e_id');
      if (e2eScenario) headers['x-e2e-scenario'] = e2eScenario;
      if (e2eId) headers['x-e2e-id'] = e2eId;

      const response = await fetch('/api/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, options }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('Content-Type') || '';

      // JSON 模式
      if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const msg = data && (data.error || data.message)
            ? String(data.error || data.message)
            : '服务暂时不可用，请稍后再试。';
          if (response.status >= 500) {
            return { retry: 'http-5xx' };
          }
          cb.onError?.(msg);
          return 'terminal';
        }
        if (data && Array.isArray(data.errors)) {
          cb.onFinal?.(data.errors, data.meta);
          return 'success';
        }
        cb.onError?.('响应格式不正确。');
        return 'terminal';
      }

      // 期望 SSE
      if (!response.ok || !response.body) {
        if (response.status >= 500) return { retry: 'http-5xx' };
        cb.onError?.('服务暂时不可用或响应无效，请稍后再试。');
        return 'terminal';
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotFinal = false;

      const readWithIdle = () =>
        new Promise<ReadableStreamReadResult<Uint8Array> | { idle: true } | { error: any }>((resolve) => {
          let settled = false;
          let timeoutId: ReturnType<typeof setTimeout>;
          const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            controller.signal.removeEventListener('abort', onAbort);
            resolve({ error: new DOMException('Aborted', 'AbortError') });
          };
          timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            controller.signal.removeEventListener('abort', onAbort);
            resolve({ idle: true });
          }, idleMs);
          reader
            .read()
            .then((r) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              controller.signal.removeEventListener('abort', onAbort);
              resolve(r);
            })
            .catch((err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              controller.signal.removeEventListener('abort', onAbort);
              resolve({ error: err });
            });
          if ((controller.signal as any).aborted) onAbort();
          else controller.signal.addEventListener('abort', onAbort);
        });

      // 读取循环
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await readWithIdle();
        if ('error' in (result as any)) throw (result as any).error;
        if ('idle' in (result as any)) {
          try { await reader.cancel(); } catch {}
          return { retry: 'idle' };
        }
        const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.startsWith('data: ')) {
            const payload = part.substring(6).trimStart();
            if (!(payload.startsWith('{') || payload.startsWith('['))) continue;
            try {
              const json = JSON.parse(payload);
              if (json.type === 'chunk') {
                const arr: ErrorItem[] = Array.isArray(json.errors) ? json.errors : [];
                cb.onChunk?.(arr);
              } else if (json.type === 'final') {
                const arr: ErrorItem[] = Array.isArray(json.errors) ? json.errors : [];
                cb.onFinal?.(arr, json.meta);
                gotFinal = true;
              } else if (json.type === 'error') {
                const code: string = json.code || 'internal';
                const rid: string | undefined = json.requestId;
                const msg = code === 'aborted' ? '请求已中止。' : `处理出错: ${json.message}`;
                cb.onError?.(msg, code, rid);
                return 'terminal';
              }
            } catch {
              // 忽略非JSON行
              continue;
            }
          }
        }
      }

      return gotFinal ? 'success' : { retry: 'eof-no-final' };
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e; // 向上交由调用方区分取消原因
      return { retry: 'network' };
    }
  };

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (remaining() <= 0) {
        cb.onError?.(`本次检测已超时（>${Math.floor(totalTimeoutMs / 1000)}s）。`);
        return 'terminal';
      }
      const res = await attemptOnce(attempt);
      if (res === 'success' || res === 'terminal') return res;

      // retry 分支
      const reason = res.retry ?? 'unknown';
      const waitMs = Math.min(calcBackoffMs(attempt, reason), remaining());
      cb.onRetry?.(reason, waitMs, attempt, maxRetries);
      await sleep(waitMs, controller.signal);
    }
    cb.onError?.(`连接中断，已重试 ${maxRetries} 次仍失败。`);
    return 'terminal';
  } finally {
    try { clearTimeout(totalTimeoutId); } catch {}
  }
}
