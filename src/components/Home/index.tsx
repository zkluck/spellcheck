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
    <div role="status" aria-busy="true" style={{ padding: 12 }}>加载结果面板…</div>
  ),
});

const enabledTypes = ['grammar', 'spelling', 'punctuation', 'fluency'];

export default function Home() {
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const { text, errors, apiError, isLoading, activeErrorId, history } = state;
  // Reviewer 开关已移除，由后端 pipeline 决定
  // 维护一个全局 AbortController，用于取消上一次请求和组件卸载时清理
  const abortRef = useRef<AbortController | null>(null);
  // 轻量提示：重试状态（不影响 reducer 的 isLoading 流程）
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  // 自定义流水线（支持每角色可选 modelName）。用户无需选择 reviewer，始终由系统自动在末尾追加。
  // 惰性初始化：首帧同步读取 localStorage，避免刷新时先渲染默认值导致的“短暂显示”。
  const [customPipeline, setCustomPipeline] = useState<RolePipelineEntry[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem('customPipelineV1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed.filter((s: RolePipelineEntry) => s.id !== 'reviewer');
        }
      }
    } catch {}
    return [{ id: 'basic', runs: 1 }];
  });
  const isPipelineEmpty = customPipeline.filter((s) => s.id !== 'reviewer').length === 0;

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
    const userOnly = next.filter((s) => s.id !== 'reviewer');
    setCustomPipeline(userOnly);
    try { if (typeof window !== 'undefined') window.localStorage.setItem('customPipelineV1', JSON.stringify(userOnly)); } catch {}
  }, []);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;
    const userStepsEmpty = customPipeline.filter((s) => s.id !== 'reviewer').length === 0;
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
      // 用户可编辑部分（不含 reviewer）
      const userSteps = customPipeline.filter((s) => s.id !== 'reviewer');
      // 发送给后端时，自动在末尾追加 reviewer 作为最终复核步骤
      const pipeline: RolePipelineEntry[] = [
        ...userSteps,
        { id: 'reviewer', runs: 1 },
      ];
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
          onFinal: (arr) => {
            clearMergeSchedulers();
            dispatch({ type: 'FINISH_CHECK', payload: arr });
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
        console.error('Check failed:', e);
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

  const handleClear = useCallback(() => {
    dispatch({ type: 'CLEAR_RESULTS' });
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
        <h1 className={cn('home__title')}>AI中文文本检测</h1>
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
            {/* Reviewer 开关已移除：由后端 WORKFLOW_PIPELINE 决定是否执行 Reviewer */}
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
              isLoading={isLoading}
              textLength={text.length}
              isPipelineEmpty={isPipelineEmpty}
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
          />
        </div>
      </div>
    </main>
  );
}
