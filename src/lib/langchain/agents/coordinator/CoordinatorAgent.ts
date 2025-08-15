import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import { mergeErrors } from '@/lib/langchain/merge';
import { logger } from '@/lib/logger';
import { CoordinatorAgentInputSchema } from '@/types/schemas';
import type { z } from 'zod';
import { ReviewerAgent } from '@/lib/langchain/agents/reviewer/ReviewerAgent';
import { config } from '@/lib/config';
import type { AgentInputWithPrevious, ReviewerInput } from '@/types/schemas';

function summarizeItems(items: ErrorItem[] | undefined) {
  if (!items) {
    return { count: 0, types: {} };
  }
  const types = items.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return { count: items.length, types };
}

type IndexMapFn = (i: number) => number;

// 复用共享 Schema，保证与 API 入参完全一致
type CoordinatorAgentInput = z.infer<typeof CoordinatorAgentInputSchema>;

// 流式回调函数类型
type StreamCallback = (chunk: { agent: string; response: AgentResponse }) => void;

/**
 * CoordinatorAgent 负责协调多个检测代理，并支持流式返回结果。
 */
export class CoordinatorAgent {
  private basicErrorAgent: BasicErrorAgent;
  private reviewerAgent: ReviewerAgent;

  constructor() {
    this.basicErrorAgent = new BasicErrorAgent();
    this.reviewerAgent = new ReviewerAgent();
  }

  async call(
    input: CoordinatorAgentInput,
    streamCallback?: StreamCallback,
    signal?: AbortSignal,
    context?: { reqId?: string },
  ): Promise<AgentResponse> {
    const parsed = CoordinatorAgentInputSchema.safeParse(input);
    if (!parsed.success) {
      try { logger.warn('coordinator.input_invalid', { zod: parsed.error.flatten?.() ?? String(parsed.error) }); } catch {}
      throw new Error('Invalid input');
    }
    const { text, options } = parsed.data;
    const enabledTypes = Array.from(new Set(options.enabledTypes));
    
    // 顺序执行（合并后简化）：
    // 1) 运行 Basic（已包含基础错误 + 流畅性）；
    // 2) 基于这些错误生成“临时修复文本”（用于多轮 Basic/Reviewer 参考）；
    // 3) 可选运行 Reviewer 对候选进行审阅与裁决。

    const allResults: AgentResponse[] = [];
    const sourceById = new Map<string, 'basic'>();

    // 合并后：只要启用了任一类型（spelling/punctuation/grammar/fluency），就需要运行 Basic
    const needsBasic = enabledTypes.some(type => ['spelling', 'punctuation', 'grammar', 'fluency'].includes(type));

    // 简洁摘要：数量、类型分布、前三条示例
    function summarizeItems(items: ErrorItem[] | undefined | null) {
      const list = Array.isArray(items) ? items : [];
      const types: Record<string, number> = {};
      for (const it of list) {
        const t = String(it.type ?? 'unknown');
        types[t] = (types[t] ?? 0) + 1;
      }
      const includeExamples = config.logging.enablePayload === true;
      const examples = includeExamples
        ? list.slice(0, 3).map((it) => ({
            id: it.id,
            type: it.type,
            text: it.text,
            suggestion: it.suggestion,
            range: [it.start, it.end],
          }))
        : undefined;
      return { count: list.length, types, ...(examples ? { examples } : {}) };
    }
    // 简化：使用 pipeline 控制顺序与次数（已去除 fluent 节点）
    const pipeline: Array<{ agent: 'basic' | 'reviewer'; runs: number }> = (config.langchain.workflow as any).pipeline ?? [
      { agent: 'basic', runs: 1 },
      { agent: 'reviewer', runs: 1 },
    ];

    // 配置一致性提示（不强制报错，仅记录）
    try {
      const pipelineAgents = pipeline.map(p => p.agent);
      if (!pipelineAgents.includes('basic') && enabledTypes.some(t => ['spelling', 'punctuation', 'grammar', 'fluency'].includes(t))) {
        logger.info('coordinator.consistency', { note: 'basic_enabled_but_pipeline_no_basic' });
      }
    } catch {}

    // 状态
    let basicResultsAll: ErrorItem[] = [];
    let patchedText = text;
    let mapPatchedToOrig: IndexMapFn | null = null;

    const recomputePatched = () => {
      if (basicResultsAll.length > 0) {
        const appliedBasic = mergeErrors(text, [basicResultsAll]);
        const appliedNonOverlap = appliedBasic.filter((e) => typeof e.suggestion === 'string' && e.suggestion.length >= 0);
        const { output, map } = applyEditsAndBuildMap(text, appliedNonOverlap);
        patchedText = output;
        mapPatchedToOrig = map;
      } else {
        patchedText = text;
        mapPatchedToOrig = null;
      }
    };

    for (const step of pipeline) {
      const runs = Math.max(0, Number(step?.runs ?? 0));
      if (step.agent === 'basic') {
        if (!needsBasic) continue;
        for (let i = 0; i < runs; i++) {
          try {
            const basicRun = i + 1;
            const prevIssuesJson = basicResultsAll.length > 0 ? JSON.stringify(basicResultsAll) : '[]';
            recomputePatched();
            const prevPatchedText = patchedText;
            const basicInput: AgentInputWithPrevious = {
              text,
              previous: { issuesJson: prevIssuesJson, patchedText: prevPatchedText, runIndex: basicRun },
            };
            const basicRes = await this.basicErrorAgent.call(basicInput, signal);
            const normalizedBasic: AgentResponse = {
              ...basicRes,
              result: (basicRes.result ?? []).map(it => ({ ...it, metadata: { ...(it.metadata ?? {}), source: 'basic' } } as ErrorItem)),
            };
            // 依据 enabledTypes 过滤，仅保留启用的类型
            const allowed = new Set(enabledTypes);
            const filteredResult = (normalizedBasic.result ?? []).filter(it => allowed.has(it.type as any));
            const filteredBasic: AgentResponse = { ...normalizedBasic, result: filteredResult };
            if (streamCallback) streamCallback({ agent: 'basic', response: filteredBasic });
            allResults.push(filteredBasic);
            for (const it of filteredResult) {
              sourceById.set(it.id, 'basic');
              basicResultsAll.push(it as ErrorItem);
            }
            logger.info('agent.basic.run.summary', { reqId: context?.reqId, run: basicRun, ...summarizeItems(filteredResult) });
            if (basicRes.error) logger.warn('agent.basic.run.error', { reqId: context?.reqId, run: basicRun, error: basicRes.error });
            recomputePatched();
          } catch (e) {
            logger.warn('agent.failed', { reqId: context?.reqId, agent: 'basic', reason: (e as Error)?.message });
          }
        }
      } else if (step.agent === 'reviewer') {
        for (let i = 0; i < runs; i++) {
          try {
            const candidateList: ErrorItem[] = allResults.flatMap(r => r.result ?? []);
            const candidateById = new Map<string, ErrorItem>(candidateList.map((c) => [c.id, c]));
            const reviewerRun = i + 1;
            const reviewerInput: ReviewerInput = {
              text,
              candidates: candidateList.map((c) => ({ id: c.id, text: c.text, start: c.start, end: c.end, suggestion: c.suggestion, type: c.type, explanation: c.explanation ?? '' })),
            };
            const reviewRes = await this.reviewerAgent.call(reviewerInput, signal);

            let finalResult: ErrorItem[] = reviewRes.result ?? [];
            if (reviewRes.result && reviewRes.decisions) {
              const acceptedIds = new Set(reviewRes.decisions.filter(d => d.status !== 'reject').map(d => d.id));
              finalResult = reviewRes.result.filter(item => acceptedIds.has(item.id));
            }

            if (streamCallback) {
              streamCallback({ agent: 'reviewer', response: { ...reviewRes, result: finalResult } });
            }

            logger.info('agent.reviewer.run.summary', { reqId: context?.reqId, run: reviewerRun, ...summarizeItems(finalResult) });
            if (reviewRes.error) {
              logger.warn('agent.reviewer.run.error', { reqId: context?.reqId, run: reviewerRun, error: reviewRes.error });
            }

            const refinedOnce = finalResult.map((it) => {
              const src = sourceById.get(it.id);
              const base = candidateById.get(it.id);
              const mergedMeta = {
                ...(base?.metadata ?? {}),
                ...(it.metadata ?? {}),
                ...(src ? { source: src } : {}),
              } as any;
              // 合并时以审阅后的结构为准，同时尽量保留原候选的有用元数据（如 originalLLM）
              return { ...(base ?? {}), ...it, metadata: mergedMeta } as ErrorItem;
            });

            // Reviewer 为最终裁决：用审阅后的结果替换之前的候选，避免“审阅前 + 审阅后”双重混入
            allResults.length = 0;
            allResults.push({ result: refinedOnce });
          } catch (e) {
            logger.warn('agent.failed', { reqId: context?.reqId, agent: 'reviewer', reason: (e as Error)?.message });
          }
        }
      }
    }

    // 已合并：流畅性（fluency）由 BasicErrorAgent 内部一次性返回，不再单独调用

    // 最终合并
    const finalCandidates: ErrorItem[] = allResults.flatMap(r => r.result ?? []);
    const mergedErrors = mergeErrors(text, [finalCandidates]);
    return { result: mergedErrors };
  }
}

/**
 * 将一组非重叠编辑（start,end,suggestion）应用到原文，生成修复文本，并构建“修复文本索引 -> 原文索引”的映射。
 * 说明：
 * - 要求 edits 已按 start 升序且互不重叠；可先用 mergeErrors(text, [edits]) 规整。
 * - 对于插入的字符（suggestion 比原片段更长的部分），其索引映射将指向编辑起点 start（近似处理）。
 */
function applyEditsAndBuildMap(original: string, edits: Array<Pick<ErrorItem, 'start' | 'end' | 'suggestion'>>): { output: string; map: (i: number) => number } {
  let out = '';
  const mapArr: number[] = [];
  let cursor = 0;
  const safeEdits = [...edits].sort((a, b) => a.start - b.start);
  for (const e of safeEdits) {
    const s = Math.max(0, Math.min(original.length, e.start));
    const en = Math.max(s, Math.min(original.length, e.end));
    // 复制未编辑部分
    const pre = original.slice(cursor, s);
    out += pre;
    for (let i = cursor; i < s; i++) mapArr.push(i);
    // 应用建议
    const sug = e.suggestion ?? '';
    out += sug;
    for (let i = 0; i < sug.length; i++) mapArr.push(s);
    cursor = en;
  }
  // 复制尾部
  const tail = original.slice(cursor);
  out += tail;
  for (let i = cursor; i < original.length; i++) mapArr.push(i);

  const map = (idx: number) => {
    if (idx < 0) return 0;
    if (idx >= mapArr.length) return original.length;
    return mapArr[idx] ?? 0;
  };
  return { output: out, map };
}
