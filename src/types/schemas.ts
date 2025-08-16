import { z } from 'zod';
import { ErrorItemSchema } from './error';

// 基础枚举：错误类型
export const EnabledTypeEnum = z.enum(['spelling', 'punctuation', 'grammar', 'fluency']);

// 角色 ID（目前内置 basic/reviewer；后续可扩展）
export const RoleIdEnum = z.enum(['basic', 'reviewer']);

// 非空且唯一的启用类型数组
export const NonEmptyEnabledTypesSchema = z
  .array(EnabledTypeEnum)
  .min(1, 'enabledTypes 不能为空')
  .refine((arr) => new Set(arr).size === arr.length, 'enabledTypes 必须唯一');

// 角色流水线项
export const RolePipelineEntrySchema = z.object({
  id: RoleIdEnum,
  runs: z.number().int().positive(),
  modelName: z.string().min(1).optional(),
});

// Analyze 选项 Schema（向后兼容：pipeline 可选）
export const AnalyzeOptionsSchema = z.object({
  enabledTypes: NonEmptyEnabledTypesSchema,
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
export type EnabledType = z.infer<typeof EnabledTypeEnum>;
export type AnalyzeOptionsInput = z.infer<typeof AnalyzeOptionsSchema>;
export type RoleId = z.infer<typeof RoleIdEnum>;
export type RolePipelineEntry = z.infer<typeof RolePipelineEntrySchema>;

// —— 通用 Agent 输入（带 previous）——
export const AgentPreviousSchema = z.object({
  issuesJson: z.string().optional(),
  patchedText: z.string().optional(),
  runIndex: z.number().optional(),
});

export const AgentInputWithPreviousSchema = z.object({
  text: z.string(),
  previous: AgentPreviousSchema.optional(),
});

// —— Reviewer 相关 ——
export const ReviewerCandidateSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  suggestion: z.string(),
  type: EnabledTypeEnum,
  explanation: z.string().optional(),
});

export const ReviewerInputSchema = z.object({
  text: z.string(),
  candidates: z.array(ReviewerCandidateSchema),
});

export const ReviewDecisionSchema = z
  .object({
    id: z.string(),
    status: z.enum(['accept', 'reject', 'modify']),
    // 当 modify 时，可返回新的 span/suggestion/explanation
    start: z.number().optional(),
    end: z.number().optional(),
    suggestion: z.string().optional(),
    explanation: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .superRefine((val, ctx) => {
    // 若同时提供 start/end，则必须合法：end > start 且二者均为有限数
    if (typeof val.start === 'number' && typeof val.end === 'number') {
      if (!(Number.isFinite(val.start) && Number.isFinite(val.end) && val.end > val.start && val.start >= 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'invalid span: require 0<=start<end' });
      }
    }
  });

export type AgentPrevious = z.infer<typeof AgentPreviousSchema>;
export type AgentInputWithPrevious = z.infer<typeof AgentInputWithPreviousSchema>;
export type ReviewerCandidate = z.infer<typeof ReviewerCandidateSchema>;
export type ReviewerInput = z.infer<typeof ReviewerInputSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

// —— Agent 返回值（运行时校验）——
export const AgentResponseSchema = z.object({
  result: z.array(ErrorItemSchema).optional(),
  error: z.string().optional(),
  rawOutput: z.string().optional(),
});
export type AgentResponseOutput = z.infer<typeof AgentResponseSchema>;
