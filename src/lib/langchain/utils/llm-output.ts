import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ErrorItem } from '@/types/error';

// 允许 LLM 返回的原始项（未包含 id/type，字段名可能为 description/explanation）
const RawLLMErrorSchema = z
  .object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
    suggestion: z.string(),
    // LLM 可能返回 description 或 explanation，二者任选其一
    description: z.string().optional(),
    explanation: z.string().optional(),
    // 某些模型可能附带 type，但我们会在上层强制覆盖为当前代理类型
    type: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (typeof val.start === 'number' && typeof val.end === 'number') {
      if (val.end <= val.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['end'],
          message: 'end must be greater than start',
        });
      }
    }
  });

export type RawLLMError = z.infer<typeof RawLLMErrorSchema>;

// 从多种 content 形态中提取 JSON 数组字符串
function extractJsonArrayString(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const s = raw.trim();
    // 优先匹配 ```json 代码块
    const fenced = s.match(/```json\n([\s\S]*?)```/i);
    if (fenced && fenced[1]) return fenced[1].trim();

    // 直接就是 JSON 数组
    if (s.startsWith('[') && s.endsWith(']')) return s;

    // 尝试提取首个数组片段
    const firstArray = s.match(/\[[\s\S]*\]/);
    if (firstArray) return firstArray[0];

    return null;
  }

  // LangChain 的 AIMessage.content 可能是分片数组
  if (Array.isArray(raw)) {
    const text = raw
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('')
      .trim();
    return extractJsonArrayString(text);
  }

  // 兜底：尝试从对象的 text 字段中获取
  if (raw && typeof raw === 'object' && 'text' in (raw as any)) {
    return extractJsonArrayString((raw as any).text);
  }

  return null;
}

export function extractJsonArrayFromContent(content: unknown): unknown[] {
  const jsonString = extractJsonArrayString(content);
  if (!jsonString) return [];
  try {
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sliceMatches(original: string, start: number, end: number, text: string): boolean {
  if (!original) return true; // 无原文时跳过校验
  if (start < 0 || end < 0 || end <= start) return false;
  return original.slice(start, end) === text;
}

export function toErrorItems(
  rawItems: unknown[],
  opts: {
    enforcedType: 'grammar' | 'spelling' | 'punctuation' | 'repetition';
    originalText?: string;
  }
): ErrorItem[] {
  const { enforcedType, originalText } = opts;

  const items: ErrorItem[] = [];
  for (const it of rawItems) {
    const parsed = RawLLMErrorSchema.safeParse(it);
    if (!parsed.success) continue;
    const { text, start, end, suggestion, description, explanation } = parsed.data;

    // 索引与原文二次校验，不一致则丢弃
    if (!sliceMatches(originalText ?? '', start, end, text)) {
      continue;
    }

    items.push({
      id: uuidv4(),
      text,
      start,
      end,
      suggestion,
      type: enforcedType,
      explanation: description ?? explanation ?? '',
    } as ErrorItem);
  }

  return items;
}
