'use client';

import classnames from 'classnames/bind';
import { ErrorItem } from '@/types/error';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ResultPanelProps {
  errors: ErrorItem[];
  onApplyError: (error: ErrorItem) => void;
  activeErrorId: string | null;
  onSelectError: (id: string | null) => void;
  isLoading: boolean;
}

export default function ResultPanel({
  errors,
  onApplyError,
  activeErrorId,
  onSelectError,
  isLoading,
}: ResultPanelProps) {
  const getErrorTypeLabel = (type: string) => {
    switch (type) {
      case 'grammar':
        return '语法';
      case 'spelling':
        return '拼写';
      case 'punctuation':
        return '标点';
      case 'repetition':
        return '重复';
      default:
        return '其他';
    }
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
      <h3 className={cn('result-panel__title')}>检测结果 ({errors.length})</h3>
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
            <div className={cn('error-item__body')}>
              <p className={cn('error-item__original')}>{error.text}</p>
              <p className={cn('error-item__suggestion')}>{error.suggestion}</p>
            </div>
            <p className={cn('error-item__explanation')}>{error.explanation}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
