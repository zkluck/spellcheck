import { NextResponse } from 'next/server';
import { analyzeText } from '@/lib/langchain';
import { z } from 'zod';
import { ErrorItemSchema } from '@/types/error';

export async function POST(request: Request) {
  try {
    const reqJson = await request.json();

    // 入参校验
    const OptionsSchema = z.object({
      enabledTypes: z.array(z.enum(['grammar', 'spelling', 'punctuation', 'repetition'])).nonempty(),
    });
    const BodySchema = z.object({
      text: z.string().min(1, 'text 不能为空'),
      options: OptionsSchema,
    });

    const parsed = BodySchema.safeParse(reqJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '请求参数不合法', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { text, options } = parsed.data;
    const startedAt = Date.now();
    const errors = await analyzeText(text, options);
    const elapsedMs = Date.now() - startedAt;

    // 出参校验（保障契约稳定，可在生产视情况关闭）
    const outputValidation = z.array(ErrorItemSchema).safeParse(errors);
    if (!outputValidation.success) {
      return NextResponse.json(
        { error: '服务输出不符合约定结构', details: outputValidation.error.flatten() },
        { status: 500 }
      );
    }

    return NextResponse.json({
      errors: outputValidation.data,
      meta: {
        elapsedMs,
        enabledTypes: options.enabledTypes,
      },
    });

  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
