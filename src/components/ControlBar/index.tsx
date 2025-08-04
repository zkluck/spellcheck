'use client';

import classnames from 'classnames/bind';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface ControlBarProps {
  onCheck: () => void;
  isLoading: boolean;
  hasErrors: boolean;
  textLength: number;
}

export default function ControlBar({ onCheck, isLoading, hasErrors, textLength }: ControlBarProps) {
  const handleCheck = () => {
    if (!isLoading) {
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
        onClick={handleCheck}
        disabled={isLoading || textLength === 0}
      >
        {isLoading ? '检测中...' : '开始检测'}
      </button>
    </div>
  );
}
