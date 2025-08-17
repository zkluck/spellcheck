'use client';

import classnames from 'classnames/bind';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ControlBarProps {
  onCheck: () => void;
  onCancel?: () => void;
  onClear?: () => void;
  isLoading: boolean;
  textLength: number;
  isPipelineEmpty: boolean;
  canClear?: boolean;
}

export default function ControlBar({ onCheck, onCancel, onClear, isLoading, textLength, isPipelineEmpty, canClear = false }: ControlBarProps) {
  const handleCheckOrCancel = () => {
    if (isLoading) {
      onCancel?.();
    } else {
      onCheck();
    }
  };
  const isStartDisabled = !isLoading && (textLength === 0 || isPipelineEmpty);

  return (
    <div className={cn('control-bar')}>
      <div className={cn('control-bar__info')}>
        <span>字符数: {textLength}</span>
      </div>
      <div className={cn('control-bar__actions')}>
        <button
          className={cn('control-bar__check-button')}
          onClick={handleCheckOrCancel}
          disabled={isStartDisabled}
        >
          {isLoading ? '取消' : '开始检测'}
        </button>
        {!isLoading && (
          <button
            className={cn('control-bar__secondary-button')}
            onClick={onClear}
            disabled={!canClear}
          >
            清空结果
          </button>
        )}
        {isPipelineEmpty && !isLoading && (
          <span
            className={cn('control-bar__hint')}
            role="status"
            aria-live="polite"
          >
            请在左侧添加至少一个角色
          </span>
        )}
      </div>
    </div>
  );
}
