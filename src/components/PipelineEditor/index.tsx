"use client";

import { useCallback, Fragment } from 'react';
import classnames from 'classnames/bind';
import styles from './index.module.scss';
import type { RolePipelineEntry } from '@/types/schemas';

const cn = classnames.bind(styles);

export type PipelineEditorProps = {
  value: RolePipelineEntry[];
  onChange: (next: RolePipelineEntry[]) => void;
  disabled?: boolean;
};

const AGENT_OPTIONS: Array<{ value: RolePipelineEntry['id']; label: string }> = [
  { value: 'basic', label: '基础 (basic)' },
];

const AGENT_DESCRIPTIONS: Record<RolePipelineEntry['id'], string> = {
  basic: '基础智能体：进行初步的语法、拼写、标点检查与轻量润色，输出稳定可靠的初稿。',
};

// 可用模型下拉：可根据需要扩展或改为从后端拉取
const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '使用默认模型' },
  { value: 'Doubao-1.5-lite-32k', label: 'Doubao-1.5-lite-32k' },
  { value: 'doubao-1.5-vision-lite-250315', label: 'Doubao-1.5-vision-lite-250315' },
  { value: 'doubao-1.5-vision-pro-250328', label: 'Doubao-1.5-vision-pro-250328' },
];

export default function PipelineEditor({ value, onChange, disabled }: PipelineEditorProps) {
  const updateRow = useCallback(
    (idx: number, patch: Partial<RolePipelineEntry>) => {
      const next: RolePipelineEntry[] = value.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      onChange(next);
    },
    [value, onChange]
  );

  const removeRow = useCallback(
    (idx: number) => {
      const next: RolePipelineEntry[] = value.filter((_, i) => i !== idx);
      onChange(next);
    },
    [value, onChange]
  );

  const addRow = useCallback(() => {
    const next: RolePipelineEntry[] = [...value, { id: 'basic', runs: 1 } as RolePipelineEntry];
    onChange(next);
  }, [value, onChange]);

  const moveRow = useCallback(
    (idx: number, dir: -1 | 1) => {
      const next: RolePipelineEntry[] = [...value];
      const ni = idx + dir;
      if (ni < 0 || ni >= next.length) return;
      const tmp = next[idx];
      next[idx] = next[ni];
      next[ni] = tmp;
      onChange(next);
    },
    [value, onChange]
  );

  return (
    <div className={cn('pipeline-editor')}>
      <div className={cn('pipeline-editor__summary')}>
        {value.map((row, idx) => (
          <Fragment key={`sum-wrap-${idx}`}>
            <div
              className={cn('pipeline-editor__summary-item')}
              title={`${(AGENT_OPTIONS.find(op => op.value === row.id)?.label) || row.id}｜${AGENT_DESCRIPTIONS[row.id] || ''}`}
            >
              <span className={cn('pipeline-editor__step-badge')}>{idx + 1}</span>
              <span className={cn('pipeline-editor__summary-label')}>
                {(AGENT_OPTIONS.find(op => op.value === row.id)?.label) || row.id}
              </span>
            </div>
            {idx < value.length - 1 && <span className={cn('pipeline-editor__summary-arrow')}>→</span>}
          </Fragment>
        ))}
      </div>
      <div className={cn('pipeline-editor__summary-note')}>
        执行顺序自左向右。
      </div>
      <div className={cn('pipeline-editor__legend')}>
        <div className={cn('pipeline-editor__legend-item')}>
          <span className={cn('pipeline-editor__legend-dot')} aria-hidden="true" />
          <span className={cn('pipeline-editor__legend-label')}>基础（basic）：{AGENT_DESCRIPTIONS.basic}</span>
        </div>
      </div>
      <div className={cn('pipeline-editor__rows')}>
        {value.map((row, idx) => (
          <div key={idx} className={cn('pipeline-editor__row')}>
            <div className={cn('pipeline-editor__row-head')}>
              <span className={cn('pipeline-editor__step-badge')}>{idx + 1}</span>
              <span className={cn('pipeline-editor__row-title')}>步骤 {idx + 1}</span>
            </div>
            <select
              className={cn('pipeline-editor__cell', 'pipeline-editor__cell--agent')}
              value={row.id}
              onChange={(e) => updateRow(idx, { id: e.target.value as RolePipelineEntry['id'] })}
              disabled={disabled}
              aria-label={`角色 ${idx + 1}`}
              title={(AGENT_OPTIONS.find(op => op.value === row.id)?.label) || ''}
            >
              {AGENT_OPTIONS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
            <div className={cn('pipeline-editor__cell-hint')}>
              {(AGENT_OPTIONS.find(op => op.value === row.id)?.label) || ''}
            </div>
            {/* runs（重复执行次数）暂时隐藏 */}

            <select
              className={cn('pipeline-editor__cell', 'pipeline-editor__cell--model')}
              value={row.modelName ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                updateRow(idx, { modelName: v || undefined });
              }}
              disabled={disabled}
              aria-label={`模型 ${idx + 1}`}
              title={(MODEL_OPTIONS.find(op => op.value === (row.modelName ?? ''))?.label) || '使用默认模型'}
            >
              {MODEL_OPTIONS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
            <div className={cn('pipeline-editor__cell-hint')}>
              {(MODEL_OPTIONS.find(op => op.value === (row.modelName ?? ''))?.label) || '使用默认模型'}
            </div>

            <div className={cn('pipeline-editor__row-controls')}>
              <button
                type="button"
                className={cn('pipeline-editor__ctrl-btn')}
                onClick={() => moveRow(idx, -1)}
                disabled={disabled || idx === 0}
                aria-label={`上移第 ${idx + 1} 行`}
              >↑</button>
              <button
                type="button"
                className={cn('pipeline-editor__ctrl-btn')}
                onClick={() => moveRow(idx, 1)}
                disabled={disabled || idx === value.length - 1}
                aria-label={`下移第 ${idx + 1} 行`}
              >↓</button>
              <button
                type="button"
                className={cn('pipeline-editor__ctrl-btn')}
                onClick={() => removeRow(idx)}
                disabled={disabled}
                aria-label={`删除第 ${idx + 1} 行`}
              >删除</button>
            </div>

            <div className={cn('pipeline-editor__row-desc')}>
              {AGENT_DESCRIPTIONS[row.id] || ''}
            </div>
          </div>
        ))}
      </div>

      <div className={cn('pipeline-editor__footer')}>
        <div />
        <button
          type="button"
          className={cn('pipeline-editor__add-btn')}
          onClick={addRow}
          disabled={disabled}
        >新增角色</button>
      </div>
    </div>
  );
}
