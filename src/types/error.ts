import { z } from 'zod';

/**
 * Zod Schema for ErrorItem for runtime validation.
 * Ensures that data from the backend API conforms to the expected structure.
 */
export const ErrorItemSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  suggestion: z.string(),
  type: z.enum(['spelling', 'punctuation', 'grammar', 'fluency']),
  explanation: z.string().optional(),
  metadata: z.record(z.any()).optional(), // For extra data like mergedFrom
});

/**
 * TypeScript type for ErrorItem for compile-time type-checking.
 * Inferred from the Zod schema to ensure consistency.
 */
export type ErrorItem = z.infer<typeof ErrorItemSchema>;
