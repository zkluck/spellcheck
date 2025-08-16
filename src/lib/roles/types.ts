/*
 * 角色与执行相关的核心类型定义
 */

export type RoleCapability =
  | 'spelling'
  | 'punctuation'
  | 'grammar'
  | 'fluency'
  | 'style'
  | 'terminology'
  | 'review';

export interface ModelSpec {
  name: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AnalysisInput {
  text: string;
  language?: string;
}

export interface RoleContext {
  // 兼容 Node/DOM 的 AbortSignal；为避免依赖 lib 冲突，这里使用 any
  signal?: any;
  metadata?: Record<string, unknown>;
}

export interface RoleChunk<T = unknown> {
  type: 'chunk';
  data: T;
}

export interface RoleFinal<T = unknown> {
  type: 'final';
  data: T;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  capabilities: RoleCapability[];
  defaultModel: ModelSpec;
  run(
    input: AnalysisInput,
    ctx: RoleContext
  ): AsyncGenerator<RoleChunk, RoleFinal, unknown> | Promise<RoleFinal>;
}

export type PipelineEntry = { id: string; runs: number; modelName?: string };

export type SSEEvent = {
  roleId: string;
  stage: 'start' | 'chunk' | 'final' | 'error';
  payload?: unknown;
  error?: string;
};

export interface ExecutorHooks {
  onStart?: (roleId: string) => void;
  onChunk?: (roleId: string, chunk: RoleChunk) => void;
  onFinal?: (roleId: string, result: RoleFinal) => void;
  onError?: (roleId: string, err: Error) => void;
}
