import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
// 在导入 route 之前 mock 执行器，以便可控产出错误项
vi.mock('@/lib/roles/executor', () => {
  return {
    runPipeline: vi.fn(async function* () {
      // 直接产出 final 事件，包含 1 条错误，契合断言
      yield {
        roleId: 'basic',
        stage: 'final',
        payload: {
          items: [
            {
              id: 'mock-error-1',
              start: 0,
              end: 2,
              text: '今天',
              suggestion: '今日',
              // type 字段已移除
              explanation: '建议用"今日"替换"今天"',
            },
          ],
        },
      } as any;
    }),
  };
});

// 在 mock 之后再导入 route 处理函数
import { POST } from '@/app/api/check/route';

describe('/api/check 接口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应当正确处理有效请求并返回结构化响应', async () => {
    // 准备请求
    const req = new NextRequest('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: '今天天气很好',
        options: {
          // enabledTypes 已移除
        },
      }),
    });

    // 调用接口
    const res = await POST(req);
    expect(res.status).toBe(200);

    // 验证响应结构
    const data = await res.json();
    expect(data).toHaveProperty('errors');
    expect(data).toHaveProperty('meta');
    expect(data.meta).toHaveProperty('elapsedMs');
    // enabledTypes 已移除，不再验证
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.length).toBe(1);
    expect(data.errors[0]).toHaveProperty('id');
    expect(data.errors[0]).toHaveProperty('start');
    expect(data.errors[0]).toHaveProperty('end');
    expect(data.errors[0]).toHaveProperty('text');
    expect(data.errors[0]).toHaveProperty('suggestion');
    // 不再验证 type 字段
  });

  it('应当验证请求体并返回400错误', async () => {
    // 准备无效请求（缺少必填字段）
    const req = new NextRequest('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // 缺少 text 字段
        options: {
          // enabledTypes 已移除
        },
      }),
    });

    // 调用接口
    const res = await POST(req);
    expect(res.status).toBe(400);

    // 验证错误响应
    const data = await res.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toBe('请求参数不合法');
    expect(data).toHaveProperty('details');
  });

  it('应当处理空文本并返回400错误', async () => {
    // 准备空文本请求
    const req = new NextRequest('http://localhost:3000/api/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: '',
        options: {
          // enabledTypes 已移除
        },
      }),
    });

    // 调用接口
    const res = await POST(req);
    expect(res.status).toBe(400);

    // 验证响应
    const data = await res.json();
    expect(data).toHaveProperty('error');
    expect(data).toHaveProperty('details');
  });
});
