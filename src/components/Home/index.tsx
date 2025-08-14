'use client';

import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import classnames from 'classnames/bind';
import TextEditor from '@/components/TextEditor';
import ControlBar from '@/components/ControlBar';
import { ErrorItem } from '@/types/error';
import { mergeErrors } from '@/lib/langchain/merge';
import { homeReducer, initialState } from './state';
import styles from './index.module.scss';
import { sseCheck } from '@/lib/api/check';

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

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;

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
      const outcome = await sseCheck(
        text,
        { enabledTypes },
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
  }, [text]);

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
              hasErrors={errors.length > 0}
              textLength={text.length}
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
