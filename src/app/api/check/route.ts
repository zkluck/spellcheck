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
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // 定义流式回调
        const streamCallback = (chunk: any) => {
          const { agent, response } = chunk;
          // 我们只流式传输每个 agent 的初步结果
          const data = {
            type: 'chunk',
            agent,
            errors: response.result,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalData)}\n\n`));
        } catch (error) {
          const errorData = { type: 'error', message: (error as Error).message };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
        } finally {
          controller.close();
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
