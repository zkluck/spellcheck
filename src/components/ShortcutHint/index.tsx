'use client';

import React, { useState } from 'react';
import classnames from 'classnames/bind';
import styles from './index.module.scss';

interface ShortcutItem {
  key: string;
  description: string;
}

interface ShortcutHintProps {
  pendingCount?: number;
  completedCount?: number;
}

const cn = classnames.bind(styles);

export default function ShortcutHint({ pendingCount = 0, completedCount = 0 }: ShortcutHintProps) {
  const [isVisible, setIsVisible] = useState(true);

  const shortcuts: ShortcutItem[] = [
    { key: 'Ctrl + Enter', description: '开始检测' },
    { key: '↑ ↓', description: '切换错误项' },
    { key: 'Enter', description: '应用建议' },
    { key: 'Backspace', description: '忽略建议' },
    { key: 'Space', description: '聚焦编辑器' },
    { key: 'Ctrl + Z', description: '撤销操作' },
  ];

  // 计算完成率
  const completionRate = pendingCount + completedCount > 0
    ? Math.round((completedCount / (pendingCount + completedCount)) * 100)
    : 0;

  if (!isVisible) {
    return (
      <button
        className={cn('shortcut-hint__toggle')}
        onClick={() => setIsVisible(true)}
        title="显示快捷键提示"
      >
        ⌨️
      </button>
    );
  }

  return (
    <div className={cn('shortcut-hint')}>
      <div className={cn('shortcut-hint__header')}>
        <h4 className={cn('shortcut-hint__title')}>快捷键</h4>
        <button
          className={cn('shortcut-hint__close')}
          onClick={() => setIsVisible(false)}
          title="隐藏快捷键提示"
        >
          ×
        </button>
      </div>
      
      <div className={cn('shortcut-hint__list')}>
        {shortcuts.map((shortcut, index) => (
          <div key={index} className={cn('shortcut-hint__item')}>
            <kbd className={cn('shortcut-hint__key')}>{shortcut.key}</kbd>
            <span className={cn('shortcut-hint__desc')}>{shortcut.description}</span>
          </div>
        ))}
      </div>
      
      <div className={cn('shortcut-hint__footer')}>
        <div className={cn('shortcut-hint__stats')}>
          <span className={cn('shortcut-hint__stat')}>
            <span className={cn('shortcut-hint__stat-number')}>{pendingCount}</span>
            <span className={cn('shortcut-hint__stat-label')}>待处理</span>
          </span>
          <span className={cn('shortcut-hint__stat')}>
            <span className={cn('shortcut-hint__stat-number')}>{completedCount}</span>
            <span className={cn('shortcut-hint__stat-label')}>已处理</span>
          </span>
          <span className={cn('shortcut-hint__stat')}>
            <span className={cn('shortcut-hint__stat-number')}>{completionRate}%</span>
            <span className={cn('shortcut-hint__stat-label')}>完成率</span>
          </span>
        </div>
      </div>
    </div>
  );
}
