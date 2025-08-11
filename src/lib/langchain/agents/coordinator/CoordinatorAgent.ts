import { AgentResponse } from '@/types/agent';
import { ErrorItem } from '@/types/error';
import { BasicErrorAgent } from '@/lib/langchain/agents/basic/BasicErrorAgent';
import { FluentAgent } from '@/lib/langchain/agents/fluent/FluentAgent';
import { mergeErrors } from '@/lib/langchain/merge';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { ReviewerAgent } from '@/lib/langchain/agents/reviewer/ReviewerAgent';
import { config } from '@/lib/config';

type IndexMapFn = (i: number) => number;

// 定义 CoordinatorAgent 的输入结构
const CoordinatorAgentInputSchema = z.object({
  text: z.string(),
  options: z.object({
    enabledTypes: z.array(z.enum(['spelling', 'punctuation', 'grammar', 'fluency'])),
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
    
    // 顺序执行：
    // 1) 运行 Basic，并按合并规则得到可应用的基础错误；
    // 2) 基于这些错误生成“临时修复文本”；
    // 3) 在修复文本上运行 Fluent；
    // 4) 将 Fluent 的索引映射回原文。

    const allResults: AgentResponse[] = [];
    const sourceById = new Map<string, 'basic' | 'fluent'>();

    const needsBasicErrors = enabledTypes.some(type => ['spelling', 'punctuation', 'grammar'].includes(type));

    // 简洁摘要：数量、类型分布、前三条示例
    function summarizeItems(items: ErrorItem[] | undefined | null) {
      const list = Array.isArray(items) ? items : [];
      const types: Record<string, number> = {};
      for (const it of list) {
        const t = String(it.type ?? 'unknown');
        types[t] = (types[t] ?? 0) + 1;
      }
      const examples = list.slice(0, 3).map((it) => ({
        id: it.id,
        type: it.type,
        text: it.text,
        suggestion: it.suggestion,
        range: [it.start, it.end],
      }));
      return { count: list.length, types, examples };
    }
    // 简化：使用 pipeline 控制顺序与次数
    const pipeline: Array<{ agent: 'basic' | 'fluent' | 'reviewer'; runs: number }> = (config.langchain.workflow as any).pipeline ?? [
      { agent: 'basic', runs: 1 },
      { agent: 'fluent', runs: 1 },
      { agent: 'reviewer', runs: 1 },
    ];

    // 状态
    let basicResultsAll: ErrorItem[] = [];
    let fluentResultsAll: ErrorItem[] = [];
    let fluentRawResultsAll: ErrorItem[] = [];
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
        if (!needsBasicErrors) continue;
        for (let i = 0; i < runs; i++) {
          try {
            const basicRun = i + 1;
            const prevIssuesJson = basicResultsAll.length > 0 ? JSON.stringify(basicResultsAll) : '[]';
            recomputePatched();
            const prevPatchedText = patchedText;
            const basicRes = await this.basicErrorAgent.call({
              text,
              previous: { issuesJson: prevIssuesJson, patchedText: prevPatchedText, runIndex: basicRun },
            } as any, signal);
            const normalizedBasic: AgentResponse = {
              ...basicRes,
              result: (basicRes.result ?? []).map(it => ({ ...it, metadata: { ...(it.metadata ?? {}), source: 'basic' } } as ErrorItem)),
            };
            if (streamCallback) streamCallback({ agent: 'basic', response: normalizedBasic });
            allResults.push(normalizedBasic);
            for (const it of normalizedBasic.result ?? []) {
              sourceById.set(it.id, 'basic');
              basicResultsAll.push(it as ErrorItem);
            }
            logger.info(`[AGENT][BASIC][RUN ${basicRun}] SUMMARY`, summarizeItems(normalizedBasic.result));
            if (normalizedBasic.error) logger.warn(`[AGENT][BASIC][RUN ${basicRun}] ERROR: ${normalizedBasic.error}`);
            recomputePatched();
          } catch (e) {
            logger.warn('Agent failed', { agent: 'basic', reason: (e as Error)?.message });
          }
        }
      } else if (step.agent === 'fluent') {
        if (!enabledTypes.includes('fluency')) continue;
        recomputePatched();
        for (let i = 0; i < runs; i++) {
          try {
            const fluentRun = i + 1;
            const fluentInputText = patchedText;
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
              previous: { issuesJson: prevFluentIssuesJson, patchedText: prevFluentPatchedText, runIndex: fluentRun },
            } as any, signal);
            const mappedFluent: ErrorItem[] = [];
            const rawFluent: ErrorItem[] = [];
            if (fluentRes.result && fluentRes.result.length > 0) {
              for (const e of fluentRes.result) {
                rawFluent.push(e as ErrorItem);
                if (!mapPatchedToOrig) {
                  mappedFluent.push({ ...e, metadata: { ...(e.metadata ?? {}), source: 'fluent' } });
                  continue;
                }
                const fn: IndexMapFn = mapPatchedToOrig;
                const ns = fn(e.start);
                const ne = fn(e.end);
                if (Number.isFinite(ns) && Number.isFinite(ne) && ns >= 0 && ne > ns && ne <= text.length) {
                  mappedFluent.push({ ...e, start: ns, end: ne, text: text.slice(ns, ne), metadata: { ...(e.metadata ?? {}), source: 'fluent' } });
                }
              }
            }
            const normalizedFluent: AgentResponse = { ...fluentRes, result: mappedFluent };
            if (streamCallback) streamCallback({ agent: 'fluent', response: normalizedFluent });
            allResults.push(normalizedFluent);
            for (const it of normalizedFluent.result ?? []) {
              sourceById.set(it.id, 'fluent');
              fluentResultsAll.push(it as ErrorItem);
            }
            if (rawFluent.length > 0) fluentRawResultsAll.push(...rawFluent);
            logger.info(`[AGENT][FLUENT][RUN ${fluentRun}] SUMMARY`, summarizeItems(normalizedFluent.result));
            if (fluentRes.error) logger.warn(`[AGENT][FLUENT][RUN ${fluentRun}] ERROR: ${fluentRes.error}`);
          } catch (e) {
            logger.warn('Agent failed', { agent: 'fluent', reason: (e as Error)?.message });
          }
        }
      } else if (step.agent === 'reviewer') {
        for (let i = 0; i < runs; i++) {
          try {
            const candidateList: ErrorItem[] = allResults.flatMap(r => r.result ?? []);
            const reviewerRun = i + 1;
            const reviewerInput = {
              text,
              candidates: candidateList.map((c) => ({ id: c.id, text: c.text, start: c.start, end: c.end, suggestion: c.suggestion, type: c.type, explanation: c.explanation ?? '' })),
            };
            const reviewRes = await this.reviewerAgent.call(reviewerInput as any, signal);
            if (streamCallback) streamCallback({ agent: 'reviewer', response: reviewRes });
            logger.info(`[AGENT][REVIEWER][RUN ${reviewerRun}] SUMMARY`, summarizeItems(reviewRes.result));
            if (reviewRes.error) logger.warn(`[AGENT][REVIEWER][RUN ${reviewerRun}] ERROR: ${reviewRes.error}`);
            const refinedOnce = (reviewRes.result ?? []).map((it) => {
              const src = sourceById.get(it.id);
              return src ? ({ ...it, metadata: { ...(it.metadata ?? {}), source: src } } as ErrorItem) : it;
            });
            allResults.push({ result: refinedOnce });
          } catch (e) {
            logger.warn('Agent failed', { agent: 'reviewer', reason: (e as Error)?.message });
          }
        }
      }
    }

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
