'use client';

import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import classnames from 'classnames/bind';
import TextEditor from '@/components/TextEditor';
const ControlBar = dynamic(() => import('@/components/ControlBar'), {
  ssr: false,
  loading: () => null,
});
// PipelineEditor 仅在客户端渲染，避免 SSR 阶段短暂显示默认智能体
const PipelineEditor = dynamic(() => import('@/components/PipelineEditor'), {
  ssr: false,
  loading: () => null,
});
import { ErrorItem } from '@/types/error';
import { mergeErrors } from '@/lib/langchain/merge';
import { homeReducer, initialState } from './state';
import styles from './index.module.scss';
import { sseCheck } from '@/lib/api/check';
import type { RolePipelineEntry } from '@/types/schemas';

const cn = classnames.bind(styles);

// 按需加载结果面板，减少首屏体积
const ResultPanel = dynamic(() => import('@/components/ResultPanel'), {
  ssr: false,
  loading: () => (
    <div className={cn('home__panel-loading')} role="status" aria-busy="true">
      <div className={cn('home__spinner')} aria-hidden="true" />
      <span>加载结果面板…</span>
      <span className={cn('sr-only')}>正在加载，请稍候</span>
    </div>
  ),
});

// 支持的错误类型配置
const enabledTypes: string[] = ['grammar', 'spelling', 'punctuation', 'fluency'];
const DRAFT_KEY = 'spellcheck.textDraft.v1';

export default function Home() {
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const { text, errors, apiError, isLoading, activeErrorId, history } = state;
  // Reviewer 已移除
  // 维护一个全局 AbortController，用于取消上一次请求和组件卸载时清理
  const abortRef = useRef<AbortController | null>(null);
  // 轻量提示：重试状态（不影响 reducer 的 isLoading 流程）
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  // 自定义流水线（支持每角色可选 modelName）。
  // 惰性初始化：首帧同步读取 localStorage，避免刷新时先渲染默认值导致的“短暂显示”。
  const [customPipeline, setCustomPipeline] = useState<RolePipelineEntry[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('customPipelineV1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed.filter((s: RolePipelineEntry) => s.id === 'basic');
        }
      }
    } catch {}
    return [{ id: 'basic', runs: 1 }];
  });
  const isPipelineEmpty = customPipeline.length === 0;

  // 流式合并的节流/批处理
  const currentErrorsRef = useRef<ErrorItem[]>([]);
  const pendingErrorsRef = useRef<ErrorItem[] | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMergeSchedulers = () => {
    try {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    } catch {}
    flushTimerRef.current = null;
    pendingErrorsRef.current = null;
  };

  const scheduleFlush = (delay = 80) => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (pendingErrorsRef.current) {
        currentErrorsRef.current = pendingErrorsRef.current;
        dispatch({ type: 'STREAM_MERGE_ERRORS', payload: currentErrorsRef.current });
        pendingErrorsRef.current = null;
      }
    }, delay);
  };

  const handleTextChange = useCallback((newText: string) => {
    dispatch({ type: 'SET_TEXT', payload: newText });
  }, []);

  // 去除二次设值的 useEffect，避免默认值 -> 存储值 的闪烁
  const handleChangeCustomPipeline = useCallback((next: RolePipelineEntry[]) => {
    const userOnly = next.filter((s) => s.id === 'basic');
    setCustomPipeline(userOnly);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('customPipelineV1', JSON.stringify(userOnly)); } catch {}
  }, []);

  // 一次性恢复文本草稿（仅当当前文本为空时）
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (text && text.length > 0) return;
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved && saved.length > 0) {
        dispatch({ type: 'SET_TEXT', payload: saved });
      }
    } catch {}
    // 仅在初次 mount 运行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防抖持久化草稿
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(DRAFT_KEY, text || '');
        } catch {}
      }, 300);
    } catch {}
    return () => {
      if (saveTimerRef.current) {
        try { clearTimeout(saveTimerRef.current); } catch {}
      }
    };
  }, [text]);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;
    const userStepsEmpty = customPipeline.length === 0;
    if (userStepsEmpty) {
      dispatch({ type: 'SET_API_ERROR', payload: '请先在左侧添加至少一个角色步骤。' });
      return;
    }

    dispatch({ type: 'START_CHECK' });
    setRetryStatus(null);

    // 重置合并与调度器
    clearMergeSchedulers();
    currentErrorsRef.current = [];

    // 若存在上一请求，先中止
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const reasonLabel = (reason?: string) => {
      switch (reason) {
        case 'http-5xx':
          return '服务器错误 (5xx)';
        case 'network':
          return '网络中断';
        case 'idle':
          return '空闲超时';
        case 'eof-no-final':
          return '流意外结束';
        default:
          return '网络波动';
      }
    };

    try {
      // 用户可编辑部分
      const pipeline: RolePipelineEntry[] = customPipeline;
      const outcome = await sseCheck(
        text,
        { enabledTypes, pipeline },
        controller,
        {
          onChunk: (arr) => {
            // 合并到当前快照（节流批量 dispatch）
            const merged = mergeErrors(text, [
              currentErrorsRef.current,
              arr,
            ]);
            pendingErrorsRef.current = merged;
            scheduleFlush(80);
          },
          onFinal: (arr, meta) => {
            clearMergeSchedulers();
            dispatch({ type: 'FINISH_CHECK', payload: { errors: arr } });
          },
          onError: (msg, _code, rid) => {
            clearMergeSchedulers();
            const banner = rid ? `${msg}（请求ID: ${rid}）` : msg;
            dispatch({ type: 'SET_API_ERROR', payload: banner });
          },
          onRetry: (reason, waitMs, attempt, max) => {
            setRetryStatus(
              `${reasonLabel(reason)}，${Math.round(waitMs / 100) / 10}s 后重试 (${attempt}/${max})…`
            );
          },
        }
      );
      // 成功或终止后，清空提示
      setRetryStatus(null);
      return outcome;
    } catch (e: any) {
      // 区分总时长上限触发 vs 用户主动取消
      const reason = (controller.signal as any)?.reason;
      setRetryStatus(null);
      if (e?.name === 'AbortError') {
        if (reason && reason.name === 'TimeoutError') {
          dispatch({ type: 'SET_API_ERROR', payload: `本次检测已超时。` });
        } else {
          dispatch({ type: 'SET_API_ERROR', payload: '请求已取消。' });
        }
      } else {
        // 使用统一的日志系统而非 console.error
        dispatch({ type: 'SET_API_ERROR', payload: '检查时发生未知错误。' });
      }
    } finally {
      // 清理当前 controller
      if (abortRef.current) {
        abortRef.current = null;
      }
      clearMergeSchedulers();
    }
  }, [text, customPipeline]);

  // 允许用户手动取消正在进行的检查
  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // 清空检测结果（不影响文本草稿）
  const handleClearResults = useCallback(() => {
    dispatch({ type: 'CLEAR_RESULTS' });
  }, []);

  // 组件卸载时中止未完成的请求
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const handleApplyError = useCallback(
    (errorToApply: ErrorItem) => {
      const { start, end, suggestion, text: originalText } = errorToApply;
      // 空建议或与原文一致：视为无可用修正，按忽略处理，避免被当作删除
      if (!suggestion || suggestion === originalText) {
        dispatch({ type: 'IGNORE_ERROR', payload: errorToApply.id });
        return;
      }

      const newText =
        text.substring(0, start) + suggestion + text.substring(end);

      const offset = suggestion.length - (end - start);
      const remainingErrors = errors
        .filter(
          (e) => e.id !== errorToApply.id && (e.end <= start || e.start >= end)
        )
        .map((e) => {
          if (e.start > start) {
            return { ...e, start: e.start + offset, end: e.end + offset };
          }
          return e;
        });

      dispatch({ type: 'APPLY_ERROR', payload: { newText, remainingErrors } });
    },
    [text, errors]
  );

  const handleIgnoreError = useCallback((errorToIgnore: ErrorItem) => {
    dispatch({ type: 'IGNORE_ERROR', payload: errorToIgnore.id });
  }, []);

  const handleApplyAll = useCallback(() => {
    if (errors.length === 0) return;
    // 仅应用有有效建议的项（建议非空且不同于原文）
    const applicable = [...errors].filter(
      (e) => e.suggestion && e.suggestion !== e.text
    );
    if (applicable.length === 0) return;
    let newText = text;
    applicable
      .sort((a, b) => b.start - a.start)
      .forEach((error) => {
        newText =
          newText.substring(0, error.start) +
          error.suggestion +
          newText.substring(error.end);
      });
    dispatch({ type: 'APPLY_ALL_ERRORS', payload: newText });
  }, [text, errors]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const handleSelectError = useCallback((id: string | null) => {
    dispatch({ type: 'SET_ACTIVE_ERROR', payload: id });
  }, []);

  // 仅当存在可应用的建议时，才允许“一键修正”
  const canApplyAll = useMemo(
    () => errors.some((e) => e.suggestion && e.suggestion !== e.text),
    [errors]
  );

  return (
    <main className={cn('home__main')}>
      <div className={cn('home__container')}>
        {apiError && (
          <div className={cn('home__error-banner')} role="alert">
            {apiError}
          </div>
        )}
        <div className={cn('home__layout')}>
          <div className={cn('home__sidebar')}>
            <h3 className={cn('home__sidebar-title')}>角色流水线</h3>
            <PipelineEditor
              value={customPipeline}
              onChange={handleChangeCustomPipeline}
              disabled={isLoading}
            />
          </div>
          <div className={cn('home__editor-section')}>
            <TextEditor
              value={text}
              onChange={handleTextChange}
              errors={errors}
              activeErrorId={activeErrorId}
              onSelectError={handleSelectError}
            />
            {/* Reviewer 已移除 */}
            {isLoading && retryStatus && (
              <div
                className={cn('home__retry-hint')}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {retryStatus}
              </div>
            )}
            <ControlBar
              onCheck={handleCheck}
              onCancel={handleCancel}
              onClear={handleClearResults}
              isLoading={isLoading}
              textLength={text.length}
              isPipelineEmpty={isPipelineEmpty}
              canClear={errors.length > 0 || !!apiError}
            />
          </div>
          <ResultPanel
            errors={errors}
            onApplyError={handleApplyError}
            onIgnoreError={handleIgnoreError}
            onApplyAll={handleApplyAll}
            onUndo={handleUndo}
            canUndo={history.length > 0}
            canApplyAll={canApplyAll}
            activeErrorId={activeErrorId}
            onSelectError={handleSelectError}
            isLoading={isLoading}
            reviewer={null}
          />
        </div>
      </div>
    </main>
  );
}
