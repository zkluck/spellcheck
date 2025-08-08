'use client';

import { useReducer, useCallback } from 'react';
import classnames from 'classnames/bind';
import TextEditor from '@/components/TextEditor';
import ControlBar from '@/components/ControlBar';
import ResultPanel from '@/components/ResultPanel';
import { ErrorItem } from '@/types/error';
import { mergeErrors } from '@/lib/langchain/merge';
import { homeReducer, initialState } from './state';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

const enabledTypes = ['grammar', 'spelling', 'punctuation', 'fluency'];

export default function Home() {
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const { text, errors, apiError, isLoading, activeErrorId, history } = state;

  const handleTextChange = useCallback((newText: string) => {
    dispatch({ type: 'SET_TEXT', payload: newText });
  }, []);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;

    dispatch({ type: 'START_CHECK' });

    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, options: { enabledTypes } }),
      });

      if (!response.ok || !response.body) {
        dispatch({ type: 'SET_API_ERROR', payload: '服务暂时不可用或响应无效，请稍后再试。' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.startsWith('data: ')) {
            try {
              const json = JSON.parse(part.substring(6));
              if (json.type === 'chunk') {
                const newErrors = mergeErrors(text, [...errors, ...json.errors]);
                dispatch({ type: 'STREAM_MERGE_ERRORS', payload: newErrors });
              } else if (json.type === 'final') {
                dispatch({ type: 'FINISH_CHECK', payload: json.errors });
              } else if (json.type === 'error') {
                dispatch({ type: 'SET_API_ERROR', payload: `处理出错: ${json.message}` });
              }
            } catch (e) {
              console.error('Error parsing stream data:', e);
              dispatch({ type: 'SET_API_ERROR', payload: '解析数据流时出错。' });
            }
          }
        }
      }
    } catch (e) {
      console.error('Check failed:', e);
      dispatch({ type: 'SET_API_ERROR', payload: '检查时发生未知错误。' });
    }
  }, [text, errors]);

  const handleApplyError = useCallback((errorToApply: ErrorItem) => {
    const { start, end, suggestion } = errorToApply;
    const newText = text.substring(0, start) + suggestion + text.substring(end);

    const offset = suggestion.length - (end - start);
    const remainingErrors = errors
      .filter(e => e.id !== errorToApply.id && (e.end <= start || e.start >= end))
      .map(e => {
        if (e.start > start) {
          return { ...e, start: e.start + offset, end: e.end + offset };
        }
        return e;
      });

    dispatch({ type: 'APPLY_ERROR', payload: { newText, remainingErrors } });
  }, [text, errors]);

  const handleIgnoreError = useCallback((errorToIgnore: ErrorItem) => {
    dispatch({ type: 'IGNORE_ERROR', payload: errorToIgnore.id });
  }, []);

  const handleApplyAll = useCallback(() => {
    if (errors.length === 0) return;
    let newText = text;
    [...errors].sort((a, b) => b.start - a.start).forEach(error => {
      newText = newText.substring(0, error.start) + error.suggestion + newText.substring(error.end);
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

  return (
    <main className={cn('home__main')}>
      <div className={cn('home__editor-section')}>
        <TextEditor
          value={text}
          onChange={handleTextChange}
          errors={errors}
          activeErrorId={activeErrorId}
          onSelectError={handleSelectError}
        />
        <ControlBar
          onCheck={handleCheck}
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
        canApplyAll={errors.length > 0}
        activeErrorId={activeErrorId}
        onSelectError={handleSelectError}
        isLoading={isLoading}
      />
    </main>
  );
}
