'use client';

import classnames from 'classnames/bind';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ControlBarProps {
  onCheck: () => void;
  onCancel?: () => void;
  isLoading: boolean;
  hasErrors: boolean;
  textLength: number;
}

export default function ControlBar({ onCheck, onCancel, isLoading, hasErrors, textLength }: ControlBarProps) {
  const handleCheckOrCancel = () => {
    if (isLoading) {
      onCancel?.();
    } else {
      onCheck();
    }
  };

  return (
    <div className={cn('control-bar')}>
      <div className={cn('control-bar__info')}>
        <span>字符数: {textLength}</span>
      </div>
      <button
        className={cn('control-bar__check-button')}
        onClick={handleCheckOrCancel}
        disabled={!isLoading && textLength === 0}
      >
        {isLoading ? '取消' : '开始检测'}
      </button>
    </div>
  );
}
