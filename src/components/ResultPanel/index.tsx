'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import classnames from 'classnames/bind';
import { ErrorItem } from '@/types/error';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

const PREFS_KEY = 'spellcheck.resultPanel.prefs';

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
  const itemRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());
  const [toastMsg, setToastMsg] = useState<string>('');
  const toastTimerRef = useRef<number | null>(null);

  // 筛选与排序状态
  const [filterSource, setFilterSource] = useState<'all' | 'basic' | 'fluent'>('all');
  // Reviewer 相关筛选已移除（决策与仅冲突）
  const [sortMode, setSortMode] = useState<'none' | 'confidence-desc'>('confidence-desc');

  // 初始化从本地存储恢复偏好
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw || '{}');
      const fs = obj.filterSource;
      const isValidSource = (v: any): v is 'all' | 'basic' | 'fluent' => v === 'all' || v === 'basic' || v === 'fluent';
      if (isValidSource(fs)) setFilterSource(fs);
      if (obj.sortMode) setSortMode(obj.sortMode);
    } catch {}
  }, []);

  // 变更时持久化偏好
  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ filterSource, sortMode })
      );
    } catch {}
  }, [filterSource, sortMode]);

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

  // 计算视图层用的错误列表（应用筛选与排序）
  const viewErrors = useMemo(() => {
    let list = errors.slice();
    // 过滤：来源
    if (filterSource !== 'all') {
      list = list.filter((e) => getSources(e).includes(filterSource));
    }
    // Reviewer 决策与冲突筛选已移除
    // 排序：置信度降序（无置信度置后）
    if (sortMode === 'confidence-desc') {
      list = list.slice().sort((a, b) => {
        const ca = getConfidence(a);
        const cb = getConfidence(b);
        const va = ca == null ? -1 : ca;
        const vb = cb == null ? -1 : cb;
        if (vb !== va) return vb - va;
        return a.start - b.start;
      });
    }
    return list;
  }, [errors, filterSource, sortMode]);

  useEffect(() => {
    measureOverflow();
    const onResize = () => measureOverflow();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureOverflow, viewErrors]);

  // 轻量 Toast 显示/隐藏
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg('');
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // 键盘导航：↑/↓ 切换，Enter 修正，Delete/Backspace 忽略
  const handleKeyDown = useCallback((e: any) => {
    let handled = false;
    const list = viewErrors;
    if (!list || list.length === 0) return;
    const idx = list.findIndex((x) => x.id === activeErrorId);

    if (e.key === 'ArrowDown') {
      const nextIdx = idx >= 0 ? Math.min(idx + 1, list.length - 1) : 0;
      onSelectError(list[nextIdx].id);
      handled = true;
    } else if (e.key === 'ArrowUp') {
      const prevIdx = idx >= 0 ? Math.max(idx - 1, 0) : 0;
      onSelectError(list[prevIdx].id);
      handled = true;
    } else if (e.key === 'Enter') {
      if (idx >= 0) {
        onApplyError(list[idx]);
        handled = true;
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (idx >= 0) {
        onIgnoreError(list[idx]);
        handled = true;
      }
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [viewErrors, activeErrorId, onSelectError, onApplyError, onIgnoreError]);

  // 选中错误时：自动展开可折叠说明，并将列表项滚动到视窗内
  useEffect(() => {
    if (!activeErrorId) return;
    // 自动展开（仅当该项说明有折叠时）
    if (overflowIds.has(activeErrorId)) {
      setExpandedIds((prev) => {
        if (prev.has(activeErrorId)) return prev;
        const next = new Set(prev);
        next.add(activeErrorId);
        return next;
      });
    }
    // 滚动定位
    const el = itemRefs.current.get(activeErrorId);
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeErrorId, overflowIds]);

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

  const getDefaultReason = useCallback((error: ErrorItem) => {
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
  }, []);

  const getDisplayExplanation = useCallback((error: ErrorItem) => {
    return (error.explanation && error.explanation.trim().length > 0)
      ? error.explanation.trim()
      : getDefaultReason(error);
  }, [getDefaultReason]);

  // 从 metadata 中提取可选的置信度（函数声明，避免 TDZ）
  function getConfidence(error: ErrorItem): number | null {
    const meta: any = (error as any).metadata ?? {};
    const raw = (error as any).confidence ?? meta?.confidence;
    if (typeof raw === 'number') return isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null;
    if (typeof raw === 'string') {
      const v = parseFloat(raw);
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
    }
    return null;
  }

  const getConfidenceClass = (val: number) => {
    if (val >= 0.8) return 'error-item__confidence--high';
    if (val >= 0.5) return 'error-item__confidence--mid';
    return 'error-item__confidence--low';
  };

  const getQuote = (error: ErrorItem): string | null => {
    const meta: any = (error as any).metadata ?? {};
    const q = (error as any).quote ?? meta?.quote ?? meta?.originalText;
    if (typeof q === 'string' && q.trim().length > 0) return q;
    return null;
  };

  // 来源/决策/冲突等元数据提取（函数声明，避免 TDZ）
  function getSources(error: ErrorItem): string[] {
    const meta: any = (error as any).metadata ?? {};
    const s = meta?.sources ?? meta?.source ?? (error as any).source;
    if (Array.isArray(s)) return s.map((x) => String(x).toLowerCase());
    if (s) return [String(s).toLowerCase()];
    return [];
  }

  const getSourceLabel = (s: string) => {
    switch (s) {
      case 'basic':
        return '基础';
      case 'fluent':
        return '流畅';
      case 'reviewer':
        return '审阅';
      default:
        return s;
    }
  };

  function getDecision(error: ErrorItem): string | null {
    const meta: any = (error as any).metadata ?? {};
    const d = meta?.reviewerDecision ?? meta?.decision ?? (error as any).decision ?? null;
    return d ? String(d).toLowerCase() : null;
  }

  const getDecisionLabel = (d: string) => {
    switch (d) {
      case 'accept':
        return '通过';
      case 'reject':
        return '驳回';
      case 'modify':
      case 'revise':
        return '修改';
      default:
        return d;
    }
  };

  function hasConflict(error: ErrorItem): boolean {
    const meta: any = (error as any).metadata ?? {};
    if (meta?.conflict === true) return true;
    if (Array.isArray(meta?.conflicts) && meta.conflicts.length > 0) return true;
    return false;
  }

  const getConflictCount = (error: ErrorItem): number => {
    const meta: any = (error as any).metadata ?? {};
    if (Array.isArray(meta?.conflicts)) return meta.conflicts.length;
    return meta?.conflict === true ? 1 : 0;
  };

  const getReviewerNotes = (error: ErrorItem): string | null => {
    const meta: any = (error as any).metadata ?? {};
    const n = meta?.reviewerNotes ?? meta?.notes ?? null;
    if (typeof n === 'string' && n.trim()) return n.trim();
    return null;
  };

  const getIndexRange = (error: ErrorItem): string => {
    const s = (error as any).start ?? (error as any).range?.start;
    const e = (error as any).end ?? (error as any).range?.end;
    if (typeof s === 'number' && typeof e === 'number') return `${s}–${e}`;
    return '';
  };

  // 构建可复制的报告文本（基于当前视图过滤结果）
  const getReportText = useCallback(() => {
    const lines: string[] = [];
    lines.push(`共 ${viewErrors.length} 条检测结果`);
    viewErrors.forEach((err, i) => {
      const idx = i + 1;
      const type = getErrorTypeLabel(err.type);
      const range = getIndexRange(err);
      const conf = getConfidence(err);
      const confPct = conf == null ? '' : `${(conf * 100).toFixed(0)}%`;
      const sources = getSources(err).map(getSourceLabel).join('/');
      const decision = getDecision(err);
      const decisionLabel = decision ? getDecisionLabel(decision) : '';
      const conflictCount = getConflictCount(err);
      const notes = getReviewerNotes(err) || '';
      const quote = getQuote(err) || '';
      const explanation = getDisplayExplanation(err);
      lines.push(
        [
          `#${idx} [${type}] ${range ? `(${range})` : ''}`.trim(),
          `原文：${err.text}`,
          `建议：${err.suggestion}`,
          quote && quote !== err.text ? `引用：${quote}` : '',
          confPct ? `置信度：${confPct}` : '',
          sources ? `来源：${sources}` : '',
          decisionLabel ? `审阅：${decisionLabel}` : '',
          conflictCount > 0 ? `冲突：${conflictCount}` : '',
          notes ? `说明：${notes}` : '',
          `原因：${explanation}`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    });
    return lines.join('\n\n');
  }, [viewErrors, getDisplayExplanation]);

  const handleCopyReport = useCallback(async () => {
    const text = getReportText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制文本报告');
    } catch {
      // 回退：下载为 txt 文件
      try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spellcheck-report.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已下载文本报告');
      } catch {
        // noop
      }
    }
  }, [getReportText, showToast]);

  // 导出：根据当前视图构造结构化列表
  const getExportList = useCallback(() => {
    return viewErrors.map((err) => {
      const conf = getConfidence(err);
      const sources = getSources(err);
      const decision = getDecision(err);
      return {
        id: err.id,
        type: err.type,
        start: (err as any).start,
        end: (err as any).end,
        text: err.text,
        suggestion: err.suggestion,
        quote: getQuote(err),
        confidence: conf,
        sources,
        decision,
        decisionLabel: decision ? getDecisionLabel(decision) : null,
        conflict: hasConflict(err),
        conflictCount: getConflictCount(err),
        notes: getReviewerNotes(err),
        explanation: getDisplayExplanation(err),
      };
    });
  }, [viewErrors, getDisplayExplanation]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportJSON = useCallback(() => {
    const data = getExportList();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, 'spellcheck-report.json');
    showToast('已导出 JSON');
  }, [getExportList, downloadBlob, showToast]);

  const toCSV = useCallback((rows: any[]) => {
    const headers = [
      'id','type','start','end','text','suggestion','quote','confidence','sources','decision','decisionLabel','conflict','conflictCount','notes','explanation'
    ];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const vals = headers.map((h) => {
        let v: any = (r as any)[h];
        if (Array.isArray(v)) v = v.join('/');
        if (v == null) v = '';
        const s = String(v).replace(/"/g, '""');
        return '"' + s + '"';
      });
      lines.push(vals.join(','));
    }
    // 加入 UTF-8 BOM，便于 Excel 识别
    return '\uFEFF' + lines.join('\n');
  }, []);

  const handleExportCSV = useCallback(() => {
    const data = getExportList();
    const csv = toCSV(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'spellcheck-report.csv');
    showToast('已导出 CSV');
  }, [getExportList, toCSV, downloadBlob, showToast]);

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
    <div
      className={cn('result-panel')}
      tabIndex={0}
      role="region"
      aria-label="检测结果"
      onKeyDown={handleKeyDown}
    >
      <div className={cn('result-panel__header')}>
        <h3 className={cn('result-panel__title')}>检测结果 ({viewErrors.length})</h3>
        <div className={cn('result-panel__actions')}>
          <button
            className={cn('result-panel__action-button', 'result-panel__action-button--secondary')}
            onClick={handleExportJSON}
            title="导出为 JSON 文件"
          >
            导出JSON
          </button>
          <button
            className={cn('result-panel__action-button', 'result-panel__action-button--secondary')}
            onClick={handleExportCSV}
            title="导出为 CSV 文件"
          >
            导出CSV
          </button>
          <button
            className={cn('result-panel__action-button', 'result-panel__action-button--secondary')}
            onClick={handleCopyReport}
            title="复制当前结果报告到剪贴板"
          >
            复制报告
          </button>
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
            disabled={!canApplyAll || viewErrors.length === 0}
          >
            一键修正
          </button>
        </div>
      </div>
      {toastMsg && (
        <div className={cn('result-panel__toast')} aria-live="polite" role="status">{toastMsg}</div>
      )}
      <div className={cn('result-panel__filters')}>
        <div className={cn('result-panel__filter-group')}>
          <label className={cn('result-panel__label')} htmlFor="filter-source">来源</label>
          <select
            id="filter-source"
            className={cn('result-panel__select')}
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as any)}
          >
            <option value="all">全部</option>
            <option value="basic">基础</option>
            <option value="fluent">流畅</option>
          </select>
        </div>
        {/* Reviewer 决策筛选与仅冲突开关已移除 */}
        <div className={cn('result-panel__filter-group')}>
          <label className={cn('result-panel__label')} htmlFor="sort-mode">排序</label>
          <select
            id="sort-mode"
            className={cn('result-panel__select')}
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as any)}
          >
            <option value="confidence-desc">置信度从高到低</option>
            <option value="none">默认</option>
          </select>
        </div>
        <div className={cn('result-panel__summary')}>
          共 {viewErrors.length} 条
        </div>
      </div>
      <ul className={cn('result-panel__error-list')}>
        {viewErrors.map((error) => (
          <li
            key={error.id}
            className={cn('error-item', {
              'error-item--active': error.id === activeErrorId,
              'error-item--conflict': hasConflict(error),
            })}
            onClick={() => onSelectError(error.id)}
            ref={(el) => {
              if (!el) {
                itemRefs.current.delete(error.id);
              } else {
                itemRefs.current.set(error.id, el);
              }
            }}
          >
            <div className={cn('error-item__header')}>
              <span className={cn('error-item__type', `error-item__type--${error.type}`)}>
                {getErrorTypeLabel(error.type)}
              </span>
              {(() => {
                const c = getConfidence(error);
                if (c == null) return null;
                const cls = getConfidenceClass(c);
                return (
                  <span className={cn('error-item__confidence', cls)} title={`置信度：${(c * 100).toFixed(0)}%`}>
                    {(c * 100).toFixed(0)}%
                  </span>
                );
              })()}
              <div className={cn('error-item__badges')}>
                {getSources(error).map((s) => (
                  <span key={s} className={cn('error-item__badge', `error-item__badge--source-${s}`)} title={`来源：${getSourceLabel(s)}`}>
                    {getSourceLabel(s)}
                  </span>
                ))}
                {(() => {
                  const d = getDecision(error);
                  if (!d) return null;
                  return (
                    <span className={cn('error-item__badge', `error-item__badge--decision-${d}`)} title={`审阅决策：${getDecisionLabel(d)}`}>
                      {getDecisionLabel(d)}
                    </span>
                  );
                })()}
                {(() => {
                  if (!hasConflict(error)) return null;
                  const count = getConflictCount(error);
                  return (
                    <span className={cn('error-item__badge', 'error-item__badge--conflict')} title={count > 1 ? `存在 ${count} 处冲突` : '存在冲突'}>
                      冲突{count > 1 ? `×${count}` : ''}
                    </span>
                  );
                })()}
              </div>
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
                  disabled={!error.suggestion || error.suggestion === error.text}
                  title={!error.suggestion || error.suggestion === error.text ? '该项仅为提示，无可用建议' : '应用此修正'}
                >
                  修正
                </button>
              </div>
            </div>
            <div className={cn('error-item__body')}>
              <p className={cn('error-item__original')}>{error.text}</p>
              <p className={cn('error-item__suggestion')}>{error.suggestion || '（无建议）'}</p>
              {(() => {
                const quote = getQuote(error);
                if (!quote) return null;
                // 若与 error.text 一致则不重复展示
                if (quote === error.text) return null;
                return (
                  <p className={cn('error-item__quote')}>
                    原文：{quote}
                  </p>
                );
              })()}
              {(() => {
                const range = getIndexRange(error);
                if (!range) return null;
                return (
                  <p className={cn('error-item__meta')}>位置：{range}</p>
                );
              })()}
              {(() => {
                const notes = getReviewerNotes(error);
                if (!notes) return null;
                return (
                  <p className={cn('error-item__notes')} title={notes}>
                    审阅说明：{notes}
                  </p>
                );
              })()}
            </div>
            <p
              className={cn('error-item__explanation', {
                'error-item__explanation--expanded': expandedIds.has(error.id),
              })}
            >
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

