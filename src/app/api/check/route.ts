import { analyzeText } from '@/lib/langchain';
import { z } from 'zod';
import { ErrorItemSchema } from '@/types/error';

// 定义请求体和选项的 Zod Schema
const OptionsSchema = z.object({
  enabledTypes: z.array(z.enum(['grammar', 'spelling', 'punctuation', 'fluency'])).nonempty(),
});
const BodySchema = z.object({
  text: z.string().min(1, 'text 不能为空'),
  options: OptionsSchema,
});

export async function POST(request: Request) {
  try {
    const reqJson = await request.json();
    const parsed = BodySchema.safeParse(reqJson);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: '请求参数不合法', details: parsed.error.flatten() }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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
      const errors = await analyzeText(text, options, collectCallback);
      const elapsedMs = Date.now() - startedAt;
      const body = {
        errors,
        meta: {
          elapsedMs,
          enabledTypes: options.enabledTypes,
          ...(warnings.length ? { warnings } : {}),
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 流式 SSE
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;
        const safeEnqueue = (obj: any) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            // 如果写入失败，视为已关闭，忽略后续写入
            isClosed = true;
          }
        };
        // 定义流式回调
        const streamCallback = (chunk: any) => {
          const { agent, response } = chunk;
          // 我们只流式传输每个 agent 的初步结果
          const data = {
            type: 'chunk',
            agent,
            errors: response.result,
          };
          safeEnqueue(data);
          if (response?.error) {
            safeEnqueue({ type: 'warning', agent, message: response.error });
          }
        };

        try {
          const startedAt = Date.now();
          // 调用核心分析函数，并传入流式回调
          const finalResult = await analyzeText(text, options, streamCallback);
          const elapsedMs = Date.now() - startedAt;

          // 在流的末尾发送最终的合并结果和元数据
          const finalData = {
            type: 'final',
            errors: finalResult,
            meta: {
              elapsedMs,
              enabledTypes: options.enabledTypes,
            },
          };
          safeEnqueue(finalData);
        } catch (error) {
          const errorData = { type: 'error', message: (error as Error).message };
          safeEnqueue(errorData);
        } finally {
          if (!isClosed) {
            try { controller.close(); } catch {}
            isClosed = true;
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
