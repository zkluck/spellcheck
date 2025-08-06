'use client';

import { useState, useCallback } from 'react';
import classnames from 'classnames/bind';
import TextEditor from '@/components/TextEditor';
import ControlBar from '@/components/ControlBar';
import ResultPanel from '@/components/ResultPanel';
import { ErrorItem } from '@/types/error';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

export default function Home() {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeErrorId, setActiveErrorId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ text: string; errors: ErrorItem[] }[]>([]);

  const handleTextChange = useCallback((newText: string) => {
    setText(newText);
  }, []);

  const handleCheck = useCallback(async () => {
    if (!text || isLoading) {
      return;
    }

    setIsLoading(true);
    setErrors([]); // Clear previous errors
    setActiveErrorId(null);

    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          options: {
            // Enable all agent types
            enabledTypes: ['grammar', 'spelling', 'punctuation', 'fluency'],
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const result: { errors: ErrorItem[]; meta?: { elapsedMs: number; enabledTypes: string[] } } = await response.json();
      if (result?.meta) {
        // 仅调试用途，可在后续接入 UI 呈现耗时与配置
        // eslint-disable-next-line no-console
        console.log('Check meta:', result.meta);
      }
      setErrors(result.errors ?? []);
    } catch (error) {
      console.error('Failed to check text:', error);
    } finally {
      setIsLoading(false);
    }
  }, [text, isLoading]);

  const handleApplyError = useCallback((errorToApply: ErrorItem) => {
    // 保存历史以支持撤回
    setHistory(prev => [...prev, { text, errors }]);
    // 最终解决方案：前端即时计算与重新索引
    const { text: errorText, suggestion, id } = errorToApply;
    const newStartIndex = text.indexOf(errorText);

    if (newStartIndex !== -1) {
      const newEndIndex = newStartIndex + errorText.length;
      // 1. 精确替换，生成新文本
      const newText = text.substring(0, newStartIndex) + suggestion + text.substring(newEndIndex);
      
      // 2. 更新文本状态
      setText(newText);

      // 3. 智能更新错误列表：重新计算所有剩余错误的位置
      setErrors(currentErrors => {
        // 首先，过滤掉刚被修正的错误
        const remainingErrors = currentErrors.filter(e => e.id !== id);
        
        // 然后，基于新文本，重新计算每一个剩余错误的位置
        return remainingErrors.map(error => {
          const newErrorStartIndex = newText.indexOf(error.text);
          if (newErrorStartIndex !== -1) {
            return {
              ...error,
              start: newErrorStartIndex,
              end: newErrorStartIndex + error.text.length,
            };
          } 
          // 如果在新文本中找不到，说明这个错误也因文本变化而失效了，一并移除
          return null;
        }).filter((e): e is ErrorItem => e !== null);
      });

      setActiveErrorId(null);
    } else {
      // 如果在当前文本中找不到这个错误，直接移除
      console.warn(`Could not find error text "${errorText}" in the current text.`);
      setErrors(currentErrors => currentErrors.filter(e => e.id !== id));
    }
  }, [text, errors]);

  const handleIgnoreError = useCallback((errorToIgnore: ErrorItem) => {
    // 保存历史以支持撤回
    setHistory(prev => [...prev, { text, errors }]);
    const { id } = errorToIgnore;
    setErrors(currentErrors => currentErrors.filter(e => e.id !== id));
    setActiveErrorId(prev => (prev === id ? null : prev));
  }, [text, errors]);

  const handleApplyAll = useCallback(() => {
    if (errors.length === 0) return;
    // 保存历史以支持撤回
    setHistory(prev => [...prev, { text, errors }]);
    // 逐条应用，基于逐次文本累积
    let newText = text;
    errors.forEach(err => {
      const idx = newText.indexOf(err.text);
      if (idx !== -1) {
        newText = newText.substring(0, idx) + err.suggestion + newText.substring(idx + err.text.length);
      }
    });
    setText(newText);
    setErrors([]);
    setActiveErrorId(null);
  }, [text, errors]);

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setText(last.text);
      setErrors(last.errors);
      setActiveErrorId(null);
      return prev.slice(0, -1);
    });
  }, []);

  return (
    <main className={cn('home__main')}>
      <div className={cn('home__editor-section')}>
        <TextEditor
          value={text}
          onChange={handleTextChange}
          errors={errors}
          activeErrorId={activeErrorId}
          onSelectError={setActiveErrorId}
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
        onSelectError={setActiveErrorId}
        isLoading={isLoading}
      />
    </main>
  );
}
