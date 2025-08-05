import { ErrorItem } from './error';

/**
 * Defines the standard response structure for all agents.
 */
export interface AgentResponse {
  result: ErrorItem[];
}

/**
 * 文本分段类型
 */
export type SegmentType = 'sentence' | 'paragraph';

/**
 * 文本片段（用于句子/段落等分割结果）
 */
export interface TextSegment {
  content: string;
  start: number;
  end: number;
  type: SegmentType;
}

/**
 * 分析选项（供 analyzeText 与各 Agent 使用）
 */
export interface AnalyzeOptions {
  enabledTypes: Array<'grammar' | 'spelling' | 'punctuation' | 'repetition'>;
}
