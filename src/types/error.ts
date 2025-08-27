import { z } from 'zod';

/**
 * Zod Schema for ErrorItem for runtime validation.
 * Ensures that data from the backend API conforms to the expected structure.
 */
// 为满足“尽量避免 any”的规则，对 metadata 定义明确结构与 unknown 兜底。
// 已知字段：source/ruleId/confidence/locate/mergedFrom 等；其余使用 catchall(unknown)。
export const ErrorMetadataSchema = z
  .object({
    source: z.enum(['rule_engine', 'llm']).optional(),
    ruleId: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    locate: z.enum(['exact', 'closest-by-hint', 'unique-text']).optional(),
    mergedFrom: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

export const ErrorItemSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  suggestion: z.string(),
  type: z.string().optional(),
  explanation: z.string().optional(),
  // 使用精确定义的元数据 Schema，并允许未知扩展字段（unknown）
  metadata: ErrorMetadataSchema.optional(),
});

/**
 * TypeScript type for ErrorItem for compile-time type-checking.
 * Inferred from the Zod schema to ensure consistency.
 */
export type ErrorMetadata = z.infer<typeof ErrorMetadataSchema>;
export type ErrorItem = z.infer<typeof ErrorItemSchema>;
