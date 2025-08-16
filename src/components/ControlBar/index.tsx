'use client';

import classnames from 'classnames/bind';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ControlBarProps {
  onCheck: () => void;
  onCancel?: () => void;
  isLoading: boolean;
  textLength: number;
  isPipelineEmpty: boolean;
}

export default function ControlBar({ onCheck, onCancel, isLoading, textLength, isPipelineEmpty }: ControlBarProps) {
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
      <button
        className={cn('control-bar__check-button')}
        onClick={handleCheckOrCancel}
        disabled={isStartDisabled}
      >
        {isLoading ? '取消' : '开始检测'}
      </button>
      {isPipelineEmpty && !isLoading && (
        <span
          role="status"
          aria-live="polite"
          style={{ marginLeft: 12, fontSize: 12, color: '#667085' }}
        >
          请在左侧添加至少一个角色
        </span>
      )}
    </div>
  );
}
