import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/check/route';

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

describe('/api/check SSE 取消/超时传播', () => {
  beforeEach(() => {
    process.env.E2E_ENABLE = '1';
  });

  it('long-stream 场景下，abort 应快速关闭 SSE 流', async () => {
    const ac = new AbortController();

    const req = new Request('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-e2e-scenario': 'long-stream',
      },
      body: JSON.stringify({ text: '测试文本', options: { enabledTypes: ['grammar'] } }),
      signal: ac.signal,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = (res as any).body as ReadableStream<Uint8Array>;
    expect(body).toBeTruthy();

    const reader = body.getReader();

    // 先读取一个 chunk（:ready），确认流已建立
    const first = await reader.read();
    expect(first.done).toBe(false);

    // 200ms 后取消请求
    setTimeout(() => ac.abort(), 200);

    // 期待在较短时间内流结束（done=true）
    const finished = await Promise.race([
      (async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) return true;
        }
      })(),
      (async () => { await delay(2000); return false; })(),
    ]);

    expect(finished).toBe(true);
  });

  it('idle-no-final 场景下，abort 也应关闭 SSE 流', async () => {
    const ac = new AbortController();

    const req = new Request('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-e2e-scenario': 'idle-no-final',
      },
      body: JSON.stringify({ text: '测试文本', options: { enabledTypes: ['grammar'] } }),
      signal: ac.signal,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = (res as any).body as ReadableStream<Uint8Array>;
    expect(body).toBeTruthy();

    const reader = body.getReader();

    // 读取 ready 注释
    const first = await reader.read();
    expect(first.done).toBe(false);

    setTimeout(() => ac.abort(), 200);

    const finished = await Promise.race([
      (async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) return true;
        }
      })(),
      (async () => { await delay(2000); return false; })(),
    ]);

    expect(finished).toBe(true);
  });
});
