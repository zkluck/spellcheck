import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import { FluentAgent } from '@/lib/langchain/agents/fluent/FluentAgent';
import { mergeErrors } from '@/lib/langchain/merge';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { ReviewerAgent } from '@/lib/langchain/agents/reviewer/ReviewerAgent';
import { config } from '@/lib/config';

// 定义 CoordinatorAgent 的输入结构
const CoordinatorAgentInputSchema = z.object({
  text: z.string(),
  options: z.object({
    enabledTypes: z.array(z.enum(['spelling', 'punctuation', 'grammar', 'fluency'])),
    reviewer: z.enum(['on', 'off']).optional(),
  }),
});

type CoordinatorAgentInput = z.infer<typeof CoordinatorAgentInputSchema>;

// 流式回调函数类型
type StreamCallback = (chunk: { agent: string; response: AgentResponse }) => void;

/**
 * CoordinatorAgent 负责协调多个检测代理，并支持流式返回结果。
 */
export class CoordinatorAgent {
  private basicErrorAgent: BasicErrorAgent;
  private fluentAgent: FluentAgent;
  private reviewerAgent: ReviewerAgent;

  constructor() {
    this.basicErrorAgent = new BasicErrorAgent();
    this.fluentAgent = new FluentAgent();
    this.reviewerAgent = new ReviewerAgent();
  }

  async call(input: CoordinatorAgentInput, streamCallback?: StreamCallback, signal?: AbortSignal): Promise<AgentResponse> {
    const { text, options } = input;
    const { enabledTypes } = options;
    // 从配置读取工作流开关，并允许 options 覆盖 reviewer 开关
    const wf = config.langchain.workflow;
    const allowBasic = wf?.useBasic !== false; // 默认允许，显式 false 则禁用
    const allowFluent = wf?.useFluent !== false; // 默认允许，显式 false 则禁用
    const reviewerMode = options.reviewer ?? (wf?.reviewer ?? 'on');
    const runReviewer = reviewerMode === 'on';
    
    // 顺序执行：
    // 1) 运行 Basic，并按合并规则得到可应用的基础错误；
    // 2) 基于这些错误生成“临时修复文本”；
    // 3) 在修复文本上运行 Fluent；
    // 4) 将 Fluent 的索引映射回原文。

    const allResults: AgentResponse[] = [];
    const sourceById = new Map<string, 'basic' | 'fluent'>();

    const needsBasicErrors = allowBasic && enabledTypes.some(type => ['spelling', 'punctuation', 'grammar'].includes(type));

    // 1) Basic 阶段（可多次调用）
    let basicResultsAll: ErrorItem[] = [];
    if (needsBasicErrors) {
      const basicRuns = Math.max(0, Number.isFinite((wf as any)?.basicCalls) ? (wf!.basicCalls as number) : 1);
      for (let i = 0; i < basicRuns; i++) {
        try {
          // 上一轮累积问题与指导性已修复文本（索引基于原文 text）
          const prevIssuesJson = basicResultsAll.length > 0 ? JSON.stringify(basicResultsAll) : '[]';
          let prevPatchedText = text;
          if (basicResultsAll.length > 0) {
            const appliedPrev = mergeErrors(text, [basicResultsAll]);
            const appliedNonOverlapPrev = appliedPrev.filter((e) => typeof e.suggestion === 'string' && e.suggestion.length >= 0);
            const { output } = applyEditsAndBuildMap(text, appliedNonOverlapPrev);
            prevPatchedText = output;
          }

          const basicRes = await this.basicErrorAgent.call({
            text,
            previous: {
              issuesJson: prevIssuesJson,
              patchedText: prevPatchedText,
              runIndex: i + 1,
            },
          } as any, signal);
          // 为 basic 结果打上来源标签
          const normalizedBasic: AgentResponse = {
            ...basicRes,
            result: (basicRes.result ?? []).map(it => ({
              ...it,
              metadata: { ...(it.metadata ?? {}), source: 'basic' },
            } as ErrorItem)),
          };
          if (streamCallback) streamCallback({ agent: 'basic', response: normalizedBasic });
          allResults.push(normalizedBasic);
          for (const it of normalizedBasic.result ?? []) {
            sourceById.set(it.id, 'basic');
            basicResultsAll.push(it as ErrorItem);
          }
          logger.debug(`\n=== BASIC AGENT DEBUG ===`);
          logger.debug('Raw LLM Output:', normalizedBasic.rawOutput);
          logger.debug('Parsed Result:', JSON.stringify(normalizedBasic.result, null, 2));
          if (normalizedBasic.error) logger.debug('Error:', normalizedBasic.error);
          logger.debug('='.repeat(40));
        } catch (e) {
          logger.warn('Agent failed', { agent: 'basic', reason: (e as Error)?.message });
        }
      }
    }

    // 2) 生成临时修复文本
    let patchedText = text;
    let mapPatchedToOrig: ((i: number) => number) | null = null;
    if (basicResultsAll.length > 0) {
      const appliedBasic = mergeErrors(text, [basicResultsAll]);
      const appliedNonOverlap = appliedBasic.filter((e) => typeof e.suggestion === 'string' && e.suggestion.length >= 0);
      const { output, map } = applyEditsAndBuildMap(text, appliedNonOverlap);
      patchedText = output;
      mapPatchedToOrig = map;
    }

    // 3) Fluent 阶段（在修复文本上运行，可多次调用）
    let fluentResultsAll: ErrorItem[] = [];
    let fluentRawResultsAll: ErrorItem[] = [];
    if (allowFluent && enabledTypes.includes('fluency')) {
      const fluentRuns = Math.max(0, Number.isFinite((wf as any)?.fluentCalls) ? (wf!.fluentCalls as number) : 1);
      for (let i = 0; i < fluentRuns; i++) {
        try {
          const fluentInputText = patchedText; // 索引基于该文本保持稳定
          // 上一轮累积问题（相对于 fluentInputText 的索引）与指导性已修复文本
          const prevFluentIssuesJson = fluentRawResultsAll.length > 0 ? JSON.stringify(fluentRawResultsAll) : '[]';
          let prevFluentPatchedText = fluentInputText;
          if (fluentRawResultsAll.length > 0) {
            const appliedPrevFluent = mergeErrors(fluentInputText, [fluentRawResultsAll]);
            const appliedNonOverlapPrevFluent = appliedPrevFluent.filter((e) => typeof e.suggestion === 'string' && e.suggestion.length >= 0);
            const { output: patchedGuidance } = applyEditsAndBuildMap(fluentInputText, appliedNonOverlapPrevFluent);
            prevFluentPatchedText = patchedGuidance;
          }

          const fluentRes = await this.fluentAgent.call({
            text: fluentInputText,
            previous: {
              issuesJson: prevFluentIssuesJson,
              patchedText: prevFluentPatchedText,
              runIndex: i + 1,
            },
          } as any, signal);
          // 4) 将 Fluent 错误索引映射回原文
          const mappedFluent: ErrorItem[] = [];
          const rawFluent: ErrorItem[] = [];
          if (fluentRes.result && fluentRes.result.length > 0) {
            for (const e of fluentRes.result) {
              rawFluent.push(e as ErrorItem);
              if (!mapPatchedToOrig) {
                // 若无映射（无基础修复），直接保留
                mappedFluent.push({ ...e, metadata: { ...(e.metadata ?? {}), source: 'fluent' } });
                continue;
              }
              const ns = mapPatchedToOrig(e.start);
              const ne = mapPatchedToOrig(e.end);
              if (Number.isFinite(ns) && Number.isFinite(ne) && ns >= 0 && ne > ns && ne <= text.length) {
                mappedFluent.push({
                  ...e,
                  start: ns,
                  end: ne,
                  text: text.slice(ns, ne),
                  metadata: { ...(e.metadata ?? {}), source: 'fluent' },
                });
              } else {
                // 映射失败则丢弃该条，避免越界
              }
            }
          }
          // 用映射后的结果替代，以保证后续 Reviewer 的 text/索引一致
          const normalizedFluent: AgentResponse = {
            ...fluentRes,
            result: mappedFluent,
          };
          if (streamCallback) streamCallback({ agent: 'fluent', response: normalizedFluent });
          allResults.push(normalizedFluent);
          for (const it of normalizedFluent.result ?? []) {
            sourceById.set(it.id, 'fluent');
            fluentResultsAll.push(it as ErrorItem);
          }
          // 累计 raw 结果（索引基于 fluentInputText）供下一轮上下文
          if (rawFluent.length > 0) {
            fluentRawResultsAll.push(...rawFluent);
          }

          logger.debug(`\n=== FLUENT AGENT DEBUG ===`);
          logger.debug('Raw LLM Output:', fluentRes.rawOutput);
          logger.debug('Parsed Result:', JSON.stringify(normalizedFluent.result, null, 2));
          if (fluentRes.error) logger.debug('Error:', fluentRes.error);
          logger.debug('='.repeat(40));
        } catch (e) {
          logger.warn('Agent failed', { agent: 'fluent', reason: (e as Error)?.message });
        }
      }
    }

    // 组装候选
    const candidateList: ErrorItem[] = allResults.flatMap(r => r.result ?? []);
    const reviewerInput = {
      text,
      candidates: candidateList.map((c) => ({
        id: c.id,
        text: c.text,
        start: c.start,
        end: c.end,
        suggestion: c.suggestion,
        type: c.type,
        explanation: c.explanation ?? '',
      })),
    };

    let refined: ErrorItem[] = [];
    try {
      // ReviewerAgent 自身已在 guard 层设置超时（默认 0.8 * analyzeTimeoutMs），并且支持父级 AbortSignal；无需额外 Promise.race
      if (runReviewer) {
        const reviewerRuns = Math.max(0, Number.isFinite((wf as any)?.reviewerCalls) ? (wf!.reviewerCalls as number) : 1);
        for (let i = 0; i < reviewerRuns; i++) {
          const reviewRes = await this.reviewerAgent.call(reviewerInput as any, signal);
          if (streamCallback) {
            streamCallback({ agent: 'reviewer', response: reviewRes });
          }

          logger.debug(`\n=== REVIEWER AGENT DEBUG ===`);
          logger.debug('Raw LLM Output:', reviewRes.rawOutput);
          logger.debug('Parsed Result:', JSON.stringify(reviewRes.result, null, 2));
          if (reviewRes.error) {
            logger.debug('Error:', reviewRes.error);
          }
          logger.debug('='.repeat(40));

          const refinedOnce = (reviewRes.result ?? []).map((it) => {
            const src = sourceById.get(it.id);
            if (src) {
              return { ...it, metadata: { ...(it.metadata ?? {}), source: src } } as ErrorItem;
            }
            return it;
          });
          refined.push(...refinedOnce);
        }
        // 去重（按 id 去重，若无 id 则保留）
        if (refined.length > 0) {
          const seen = new Set<string>();
          refined = refined.filter((e) => {
            if (!e.id) return true;
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
          });
        }
      } else {
        // reviewer 关闭：直接使用候选合并
        refined = candidateList;
      }
    } catch (e) {
      const reason = (e as Error)?.message;
      logger.warn('ReviewerAgent failed', { reason });
      if (streamCallback) {
        streamCallback({ agent: 'reviewer', response: { result: [], error: reason } as any });
      }
    }

    // 最终合并（主要用于去重与冲突解决）
    // 若审阅阶段无结果，则回退到原始候选的合并，避免“全空”
    const mergedErrors = refined.length > 0
      ? mergeErrors(text, [refined])
      : mergeErrors(text, allResults.map(r => r.result));

    return {
      result: mergedErrors,
    };
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
