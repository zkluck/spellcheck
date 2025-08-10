import { describe, it, expect } from 'vitest';
import { guardLLMInvoke, withRetry } from './llm-guard';

function createAbortError(): Error {
  const err = new Error('Aborted');
  (err as any).name = 'AbortError';
  return err;
}

describe('llm-guard', () => {
  it('guardLLMInvoke: respects parent abort (immediate)', async () => {
    const ac = new AbortController();
    ac.abort();
    const invoker = async (_signal?: AbortSignal) => 'ok';
    await expect(
      guardLLMInvoke(invoker, { operationName: 'test.abort', parentSignal: ac.signal, timeoutMs: 1000 })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('guardLLMInvoke: aborts on timeout and propagates to invoker', async () => {
    const invoker = (signal?: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        // 模拟长时间运行且监听取消
        const onAbort = () => reject(createAbortError());
        if (signal) {
          if (signal.aborted) return reject(createAbortError());
          signal.addEventListener('abort', onAbort);
        }
        // 永不 resolve，依赖超时触发取消
      });

    const start = Date.now();
    await expect(
      guardLLMInvoke(invoker, { operationName: 'test.timeout', timeoutMs: 30 })
    ).rejects.toMatchObject({ name: 'AbortError' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('withRetry: retries on retryable error and eventually succeeds', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      if (attempts <= 2) {
        const err: any = new Error('server error');
        err.status = 500;
        throw err;
      }
      return 'ok';
    };

    const res = await withRetry(op, { retries: 3, operationName: 'test.retry' });
    expect(res).toBe('ok');
    expect(attempts).toBe(3); // 2 次失败 + 1 次成功
  });

  it('withRetry: does not retry on AbortError', async () => {
    let attempts = 0;
    const op = async () => {
      attempts += 1;
      const err = createAbortError();
      throw err;
    };

    await expect(withRetry(op as any, { retries: 3, operationName: 'test.abort-no-retry' })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(attempts).toBe(1);
  });
});
