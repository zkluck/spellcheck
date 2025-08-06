'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import classnames from 'classnames/bind';
import { ErrorItem } from '@/types/error';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ResultPanelProps {
  errors: ErrorItem[];
  onApplyError: (error: ErrorItem) => void;
  onIgnoreError: (error: ErrorItem) => void;
  onApplyAll: () => void;
  onUndo: () => void;
  canUndo?: boolean;
  canApplyAll?: boolean;
  activeErrorId: string | null;
  onSelectError: (id: string | null) => void;
  isLoading: boolean;
}

export default function ResultPanel({
  errors,
  onApplyError,
  onIgnoreError,
  onApplyAll,
  onUndo,
  canUndo = false,
  canApplyAll = true,
  activeErrorId,
  onSelectError,
  isLoading,
}: ResultPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const textRefs = useRef<Map<string, HTMLSpanElement | null>>(new Map());

  const setTextRef = useCallback((id: string) => (el: HTMLSpanElement | null) => {
    textRefs.current.set(id, el);
  }, []);

  const measureOverflow = useCallback(() => {
    const next = new Set<string>();
    textRefs.current.forEach((el, id) => {
      if (!el) return;
      const style = window.getComputedStyle(el);
      const lineHeightStr = style.lineHeight;
      let lineHeight = parseFloat(lineHeightStr);
      if (Number.isNaN(lineHeight)) {
        const fontSize = parseFloat(style.fontSize || '16');
        lineHeight = fontSize * 1.4; // fallback
      }
      const isMultiLine = el.scrollHeight - 1 > lineHeight; // allow tiny rounding
      if (isMultiLine) next.add(id);
    });
    setOverflowIds(next);
  }, []);

  useEffect(() => {
    measureOverflow();
    const onResize = () => measureOverflow();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureOverflow, errors]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const getErrorTypeLabel = (type: string) => {
    switch (type) {
      case 'grammar':
        return '语法';
      case 'spelling':
        return '拼写';
      case 'punctuation':
        return '标点';
      case 'fluency':
        return '流畅';
      default:
        return '其他';
    }
  };

  const getDefaultReason = (error: ErrorItem) => {
    switch (error.type) {
      case 'grammar':
        return '句法结构或搭配不当，可能存在主谓宾不一致、修饰关系错误等，建议按提示调整语序或用词。';
      case 'spelling':
        return '检测到疑似错别字或同音/近形混淆，请参考建议用词进行纠正。';
      case 'punctuation':
        return '标点符号使用可能不规范，如多余/缺失/全角半角混用等，建议按提示修正。';
      case 'fluency':
        return '存在重复、赘余或不够通顺的表述，建议精简或优化以提升可读性与流畅度。';
      default:
        return '检测到潜在问题，请参考建议。';
    }
  };

  const getDisplayExplanation = (error: ErrorItem) => {
    return (error.explanation && error.explanation.trim().length > 0)
      ? error.explanation.trim()
      : getDefaultReason(error);
  };

  if (isLoading) {
    return (
      <div className={cn('result-panel', 'result-panel--loading')}>
        <div className={cn('result-panel__loader')}></div>
        <p>正在检测中，请稍候...</p>
      </div>
    );
  }

  if (errors.length === 0) {
    return (
      <div className={cn('result-panel', 'result-panel--empty')}>
        <div className={cn('result-panel__empty-icon')}>✓</div>
        <h3>暂无检测结果</h3>
        <p>输入文本后点击“开始检测”</p>
      </div>
    );
  }

  return (
    <div className={cn('result-panel')}>
      <div className={cn('result-panel__header')}>
        <h3 className={cn('result-panel__title')}>检测结果 ({errors.length})</h3>
        <div className={cn('result-panel__actions')}>
          <button
            className={cn('result-panel__action-button', 'result-panel__action-button--secondary')}
            onClick={onUndo}
            disabled={!canUndo}
          >
            撤回修改
          </button>
          <button
            className={cn('result-panel__action-button', 'result-panel__action-button--primary')}
            onClick={onApplyAll}
            disabled={!canApplyAll || errors.length === 0}
          >
            一键修正
          </button>
        </div>
      </div>
      <ul className={cn('result-panel__error-list')}>
        {errors.map((error) => (
          <li
            key={error.id}
            className={cn('error-item', { 'error-item--active': error.id === activeErrorId })}
            onClick={() => onSelectError(error.id)}
          >
            <div className={cn('error-item__header')}>
              <span className={cn('error-item__type', `error-item__type--${error.type}`)}>
                {getErrorTypeLabel(error.type)}
              </span>
              <div className={cn('error-item__actions')}>
                <button
                  className={cn('error-item__ignore-button')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onIgnoreError(error);
                  }}
                >
                  忽略
                </button>
                <button
                  className={cn('error-item__apply-button')}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent li onClick from firing
                    onApplyError(error);
                  }}
                >
                  修正
                </button>
              </div>
            </div>
            <div className={cn('error-item__body')}>
              <p className={cn('error-item__original')}>{error.text}</p>
              <p className={cn('error-item__suggestion')}>{error.suggestion}</p>
            </div>
            <p className={cn('error-item__explanation')}>
              <span className={cn('error-item__explanation-label')}>原因：</span>
              <span
                id={`exp-${error.id}`}
                className={cn('error-item__explanation-text', {
                  'error-item__explanation-text--clamped': overflowIds.has(error.id) && !expandedIds.has(error.id),
                })}
                ref={setTextRef(error.id)}
              >
                {getDisplayExplanation(error)}
              </span>
              {overflowIds.has(error.id) && (
                <button
                  type="button"
                  className={cn('error-item__explanation-toggle')}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(error.id); }}
                  aria-expanded={expandedIds.has(error.id)}
                  aria-controls={`exp-${error.id}`}
                >
                  {expandedIds.has(error.id) ? '收起' : '展开'}
                </button>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

