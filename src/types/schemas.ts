import { z } from 'zod';
import { ErrorItemSchema } from './error';

// 角色 ID（目前内置 basic；后续可扩展）
export const RoleIdEnum = z.enum(['basic']);

// 角色流水线项
export const RolePipelineEntrySchema = z.object({
  id: RoleIdEnum,
  runs: z.number().int().positive(),
  modelName: z.string().min(1).optional(),
});

// Analyze 选项 Schema（向后兼容：pipeline 可选）
export const AnalyzeOptionsSchema = z.object({
  pipeline: z.array(RolePipelineEntrySchema).optional(),
});

// API 请求体 Schema（/api/check）
export const AnalyzeRequestSchema = z.object({
  text: z.string().min(1, 'text 不能为空'),
  options: AnalyzeOptionsSchema,
});

// CoordinatorAgent 入参 Schema（与 AnalyzeRequestSchema 对齐）
export const CoordinatorAgentInputSchema = AnalyzeRequestSchema;

// TypeScript 类型导出
export type AnalyzeOptionsInput = z.infer<typeof AnalyzeOptionsSchema>;
export type RoleId = z.infer<typeof RoleIdEnum>;
export type RolePipelineEntry = z.infer<typeof RolePipelineEntrySchema>;

// —— 通用 Agent 输入 ——
export const AgentInputSchema = z.object({
  text: z.string(),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;

// —— Agent 返回值（运行时校验）——
export const AgentResponseSchema = z.object({
  result: z.array(ErrorItemSchema),
  error: z.string().optional(),
  rawOutput: z.string().optional(),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseSchema>;
