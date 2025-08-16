import { describe, it, expect, beforeEach, vi } from 'vitest';
import { config } from '@/lib/config';

let capturedRoles: Array<{ id: string; runs: number; modelName?: string }> = [];

vi.mock('@/lib/roles/executor', () => {
  return {
    runPipeline: vi.fn(async function* (opts: any) {
      capturedRoles = opts.roles || [];
      // 模拟产生一个 chunk 与一个 final，避免真实实现依赖
      yield { roleId: capturedRoles[0]?.id ?? 'basic', stage: 'chunk', payload: { items: [] } } as any;
      yield { roleId: capturedRoles[capturedRoles.length - 1]?.id ?? 'basic', stage: 'final', payload: { items: [] } } as any;
    }),
  };
});

// 在 mock 之后再导入 route 处理函数，确保拦截到 runPipeline
import { POST } from '@/app/api/check/route';

describe('API /api/check SSE 管道选择', () => {
  beforeEach(() => {
    capturedRoles = [];
    // 确保禁用 E2E 特殊分支，走正常 SSE 流
    delete process.env.E2E_ENABLE;
  });

  it('当提供 options.pipeline 时，SSE 分支应优先使用该流水线', async () => {
    const body = {
      text: '测试文本',
      options: {
        enabledTypes: ['grammar'],
        pipeline: [{ id: 'reviewer', runs: 1 }],
      },
    };

    const req = new Request('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const bodyStream = (res as any).body as ReadableStream<Uint8Array>;
    expect(bodyStream).toBeTruthy();

    // 读完流，确保生成器被完整消费
    const reader = bodyStream.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(capturedRoles).toMatchObject([{ id: 'reviewer', runs: 1 }]);
  });

  it('未提供 options.pipeline 时，SSE 分支应回退到 config.langchain.workflow.pipeline', async () => {
    const body = {
      text: '测试文本',
      options: {
        enabledTypes: ['grammar'],
      },
    };

    const req = new Request('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const bodyStream = (res as any).body as ReadableStream<Uint8Array>;
    expect(bodyStream).toBeTruthy();

    const reader = bodyStream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const expected = (config.langchain.workflow.pipeline || []).map((p) => ({ id: p.agent, runs: p.runs }));
    expect(capturedRoles).toMatchObject(expected);
  });
});
