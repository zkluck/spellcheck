import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, error } = body;

    if (!text || !error || !error.text || !error.suggestion) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 执行一次性的、精确的查找和替换
    const newText = text.replace(error.text, error.suggestion);

    return NextResponse.json({ newText });
  } catch (e) {
    console.error('Error in apply-suggestion:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
