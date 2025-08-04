import { NextResponse } from 'next/server';
import { analyzeText } from '@/lib/langchain';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, options } = body;

    if (!text || !options) {
      return NextResponse.json({ error: 'Missing text or options' }, { status: 400 });
    }

    const errors = await analyzeText(text, options);
    return NextResponse.json(errors);

  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
