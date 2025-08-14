'use client';

import { useReducer, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import classnames from 'classnames/bind';
import TextEditor from '@/components/TextEditor';
import ControlBar from '@/components/ControlBar';
import ResultPanel from '@/components/ResultPanel';
import { ErrorItem } from '@/types/error';
import { mergeErrors } from '@/lib/langchain/merge';
import { homeReducer, initialState } from './state';
import styles from './index.module.scss';
import { feConfig } from '@/lib/feConfig';

const cn = classnames.bind(styles);

const enabledTypes = ['grammar', 'spelling', 'punctuation', 'fluency'];

export default function Home() {
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const { text, errors, apiError, isLoading, activeErrorId, history } = state;
  // Reviewer 开关已移除，由后端 pipeline 决定
  // 维护一个全局 AbortController，用于取消上一次请求和组件卸载时清理
  const abortRef = useRef<AbortController | null>(null);
  // 轻量提示：重试状态（不影响 reducer 的 isLoading 流程）
  const [retryStatus, setRetryStatus] = useState<string | null>(null);

  const handleTextChange = useCallback((newText: string) => {
    dispatch({ type: 'SET_TEXT', payload: newText });
  }, []);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;

    dispatch({ type: 'START_CHECK' });
    setRetryStatus(null);

    // 若存在上一请求，先中止
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const maxRetries = feConfig.maxRetries;
    const baseDelay = feConfig.baseDelayMs; // ms 基础退避（集中配置）
    const idleMs = feConfig.idleMs; // 若超过设定时长未收到数据/心跳，认为连接空闲并重试

    // 总时长上限（超出则终止）
    const totalTimeoutMs = feConfig.totalTimeoutMs;
    const totalDeadline = Date.now() + totalTimeoutMs;
    const remaining = () => Math.max(0, totalDeadline - Date.now());
    const totalTimeoutId = setTimeout(() => {
      try {
        // 标记为总时长超时
        controller.abort(
          new DOMException('Total timeout exceeded', 'TimeoutError')
        );
      } catch {}
    }, totalTimeoutMs);

    const sleep = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(id);
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const id = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        if ((signal as any)?.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort);
        }
      });

    type AttemptOutcome = {
      outcome: 'success' | 'terminal' | 'retry';
      reason?: string;
      waitMs?: number;
    };

    const calcBackoffMs = (attempt: number, reason?: string) => {
      // 基于原因微调基数
      let base = baseDelay;
      if (reason === 'http-5xx') base = 800;
      else if (reason === 'network') base = 700;
      else if (reason === 'idle') base = 600;
      else if (reason === 'eof-no-final') base = 650;
      // 指数退避 + 抖动
      const raw = base * Math.pow(2, attempt - 1);
      const jitter = 0.2 + Math.random() * 0.3; // 20%-50%
      const withJitter = raw * (1 + jitter);
      // 夹在[min,max]
      return Math.max(
        feConfig.backoffMinMs,
        Math.min(feConfig.backoffMaxMs, Math.floor(withJitter))
      );
    };

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

    const attemptOnce = async (attempt: number): Promise<AttemptOutcome> => {
      try {
        // E2E: 若存在 cookie 注入，则透传为请求头，确保后端能稳定识别场景
        const cookie =
          typeof document !== 'undefined' ? document.cookie || '' : '';
        const pick = (name: string) => {
          const m = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
          return m ? decodeURIComponent(m[1]) : undefined;
        };
        const e2eScenario = pick('e2e_scenario');
        const e2eId = pick('e2e_id');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        };
        if (e2eScenario) headers['x-e2e-scenario'] = e2eScenario;
        if (e2eId) headers['x-e2e-id'] = e2eId;

        const response = await fetch('/api/check', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, options: { enabledTypes } }),
          signal: controller.signal,
        });
        const reqId = response.headers.get('X-Request-Id') || undefined;
        console.info('[sse] attempt', attempt, 'requestId', reqId || 'N/A');
        // E2E: 将阶段/场景打印到控制台，供用例稳定捕获（若服务端头缺失，则回退基于状态码/Content-Type 判断）
        try {
          const scenarioHdr = response.headers.get('X-E2E-Scenario');
          let stage = response.headers.get('X-E2E-Stage');
          if (!stage) {
            if (response.status >= 500) stage = 'first';
            else {
              const ct = response.headers.get('Content-Type') || '';
              if (response.ok && ct.includes('text/event-stream')) stage = 'ok';
            }
          }
          if (stage)
            console.info('[e2e] stage', stage, 'scenario', scenarioHdr || '');
        } catch {}

        const contentType = response.headers.get('Content-Type') || '';

        // JSON 路径：一次性结果或错误
        if (contentType.includes('application/json')) {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const msg =
              data && (data.error || data.message)
                ? String(data.error || data.message)
                : '服务暂时不可用，请稍后再试。';
            // 5xx 可重试
            if (response.status >= 500) {
              return { outcome: 'retry', reason: 'http-5xx' };
            }
            // 其他 4xx 终止并提示
            dispatch({ type: 'SET_API_ERROR', payload: msg });
            return { outcome: 'terminal' };
          }
          if (data && Array.isArray(data.errors)) {
            dispatch({ type: 'FINISH_CHECK', payload: data.errors });
            return { outcome: 'success' };
          }
          dispatch({ type: 'SET_API_ERROR', payload: '响应格式不正确。' });
          return { outcome: 'terminal' };
        }

        // 期望为 SSE 流
        if (!response.ok || !response.body) {
          // 仅对 5xx 进行重试
          if (response.status >= 500) {
            return { outcome: 'retry', reason: 'http-5xx' };
          }
          dispatch({
            type: 'SET_API_ERROR',
            payload: '服务暂时不可用或响应无效，请稍后再试。',
          });
          return { outcome: 'terminal' };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotFinal = false;
        let currentErrors: ErrorItem[] = [];

        // 读取封装：支持空闲超时，并避免事件监听泄漏
        const readWithIdle = () =>
          new Promise<
            | ReadableStreamReadResult<Uint8Array>
            | { idle: true }
            | { error: any }
          >((resolve) => {
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout>;
            const onAbort = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              controller.signal.removeEventListener('abort', onAbort);
              resolve({ error: new DOMException('Aborted', 'AbortError') });
            };
            timeoutId = setTimeout(() => {
              if (settled) return;
              settled = true;
              controller.signal.removeEventListener('abort', onAbort);
              resolve({ idle: true });
            }, idleMs);
            reader
              .read()
              .then((r) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                controller.signal.removeEventListener('abort', onAbort);
                resolve(r);
              })
              .catch((err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                controller.signal.removeEventListener('abort', onAbort);
                resolve({ error: err });
              });
            if ((controller.signal as any).aborted) onAbort();
            else controller.signal.addEventListener('abort', onAbort);
          });

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await readWithIdle();
          if ('error' in (result as any)) {
            throw (result as any).error;
          }
          if ('idle' in (result as any)) {
            // 空闲：尝试取消当前 reader 并进入重试
            try {
              await reader.cancel();
            } catch {}
            return { outcome: 'retry', reason: 'idle' };
          }
          const { done, value } =
            result as ReadableStreamReadResult<Uint8Array>;
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const payload = part.substring(6).trimStart();
              if (!(payload.startsWith('{') || payload.startsWith('['))) {
                // 非 JSON 结构，忽略
                continue;
              }
              try {
                const json = JSON.parse(payload);
                if (json.type === 'chunk') {
                  currentErrors = mergeErrors(text, [
                    ...currentErrors,
                    ...json.errors,
                  ]);
                  dispatch({
                    type: 'STREAM_MERGE_ERRORS',
                    payload: currentErrors,
                  });
                } else if (json.type === 'final') {
                  dispatch({ type: 'FINISH_CHECK', payload: json.errors });
                  gotFinal = true;
                } else if (json.type === 'error') {
                  // 服务器明确错误：终止（包含标准化 code 与 requestId）
                  const code: string = json.code || 'internal';
                  const rid: string | undefined = json.requestId || reqId;
                  const msg =
                    code === 'aborted'
                      ? '请求已中止。'
                      : `处理出错: ${json.message}`;
                  const banner = rid ? `${msg}（请求ID: ${rid}）` : msg;
                  dispatch({ type: 'SET_API_ERROR', payload: banner });
                  return { outcome: 'terminal' };
                }
              } catch (e) {
                console.warn('SSE data JSON parse failed:', e);
                // 忽略该条负载，继续读取
                continue;
              }
            }
          }
        }

        // 流自然结束但未收到 final，视为可重试的中断
        return gotFinal
          ? { outcome: 'success' }
          : { outcome: 'retry', reason: 'eof-no-final' };
      } catch (e) {
        if ((e as any)?.name === 'AbortError') {
          // 直接向上抛给外层捕获并处理
          throw e;
        }
        console.warn(`Attempt ${attempt} failed:`, e);
        return { outcome: 'retry', reason: 'network' };
      }
    };

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // 若无剩余时间，直接终止
        if (remaining() <= 0) {
          setRetryStatus(null);
          dispatch({
            type: 'SET_API_ERROR',
            payload: `本次检测已超时（>${Math.floor(
              totalTimeoutMs / 1000
            )}s）。`,
          });
          return;
        }
        const res = await attemptOnce(attempt);
        if (res.outcome === 'success' || res.outcome === 'terminal') {
          setRetryStatus(null);
          return;
        }
        // retry 分支：指数退避 + 抖动
        const waitMs = Math.min(
          res.waitMs ?? calcBackoffMs(attempt, res.reason),
          remaining()
        );
        setRetryStatus(
          `${reasonLabel(res.reason)}，${
            Math.round(waitMs / 100) / 10
          }s 后重试 (${attempt}/${maxRetries})…`
        );
        await sleep(waitMs, controller.signal);
      }
      // 达到最大重试次数仍失败
      setRetryStatus(null);
      dispatch({
        type: 'SET_API_ERROR',
        payload: `连接中断，已重试 ${maxRetries} 次仍失败。`,
      });
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        // 区分总时长上限触发 vs 用户主动取消
        const reason = (controller.signal as any)?.reason;
        setRetryStatus(null);
        if (reason && reason.name === 'TimeoutError') {
          dispatch({
            type: 'SET_API_ERROR',
            payload: `本次检测已超时（>${Math.floor(
              totalTimeoutMs / 1000
            )}s）。`,
          });
        } else {
          dispatch({ type: 'SET_API_ERROR', payload: '请求已取消。' });
        }
      } else {
        console.error('Check failed:', e);
        setRetryStatus(null);
        dispatch({ type: 'SET_API_ERROR', payload: '检查时发生未知错误。' });
      }
    } finally {
      // 清理当前 controller
      if (abortRef.current) {
        abortRef.current = null;
      }
      // 清理总时长定时器
      try {
        clearTimeout(totalTimeoutId);
      } catch {}
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
              <div className={cn('home__retry-hint')}>{retryStatus}</div>
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
