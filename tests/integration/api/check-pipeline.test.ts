import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config } from '@/lib/config';

let capturedRoles: Array<{ id: string; runs: number; modelName?: string }> = [];

// 在导入 route 之前 mock 执行器，以便拦截 roles 参数
vi.mock('@/lib/roles/executor', () => {
  return {
    runPipeline: vi.fn(async function* (opts: any) {
      capturedRoles = opts.roles || [];
      // 直接返回 final 事件，避免依赖实际角色实现
      yield {
        roleId: capturedRoles[capturedRoles.length - 1]?.id ?? 'basic',
        stage: 'final',
        payload: { items: [] },
      } as any;
    }),
  };
});

// 在 mock 之后再导入 route 处理函数
import { POST } from '@/app/api/check/route';

describe('API /api/check pipeline 选择', () => {
  beforeEach(() => {
    capturedRoles = [];
  });

  it('当提供 options.pipeline 时应优先使用该流水线', async () => {
    const body = {
      text: '测试文本',
      options: {
        // enabledTypes 已移除
        pipeline: [{ id: 'basic', runs: 1 }],
      },
    };

    const req = new NextRequest('http://localhost:3000/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(capturedRoles).toMatchObject([{ id: 'basic', runs: 1 }]);
  });

  it('未提供 pipeline 时应回退到 config.langchain.workflow.pipeline', async () => {
    const body = {
      text: '测试文本',
      options: {
        // enabledTypes 已移除
      },
    };

    const req = new NextRequest('http://localhost:3000/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);

    const expected = (config.langchain.workflow.pipeline || []).map((p) => ({ id: p.agent, runs: p.runs }));
    expect(capturedRoles).toEqual(expected);
  });
});
