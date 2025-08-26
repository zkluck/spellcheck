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
  // 取消信号：使用标准 AbortSignal，兼容 Node 与浏览器环境
  // 角色实现必须在收到取消信号后尽快退出，避免长时间占用资源
  signal?: AbortSignal;
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
  // 当前事件所属的运行轮次索引（0 基），用于前端聚合展示
  runIndex?: number;
};

export interface ExecutorHooks {
  onStart?: (roleId: string) => void;
  onChunk?: (roleId: string, chunk: RoleChunk) => void;
  onFinal?: (roleId: string, result: RoleFinal) => void;
  onError?: (roleId: string, err: Error) => void;
}
