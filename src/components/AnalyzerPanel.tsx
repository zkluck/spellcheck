import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { analyzeText } from '@/lib/langchain';
import type { ErrorItem } from '@/types/error';
import type { AnalyzeOptions } from '@/types/agent';
import { mergeErrors } from '@/lib/langchain/merge';
import styles from './AnalyzerPanel.module.scss';

type SourceTag = 'basic' | 'fluent' | 'final';

// 轻量级 class 合并
const cx = (...cls: Array<string | false | null | undefined>) => cls.filter(Boolean).join(' ');

function applySelectedEdits(base: string, edits: ErrorItem[]): string {
  // 使用后端同款合并策略，自动去重与解决重叠
  if (!edits || edits.length === 0) return base;
  const merged = mergeErrors(base, [edits]);
  let out = '';
  let cursor = 0;
  for (const e of merged) {
    const s = Math.max(0, Math.min(base.length, e.start));
    const en = Math.max(s, Math.min(base.length, e.end));
    out += base.slice(cursor, s);
    out += e.suggestion ?? '';
    cursor = en;
  }
  out += base.slice(cursor);
  return out;
}

export const AnalyzerPanel: React.FC = () => {
  const [text, setText] = useState<string>('这里输入要检测的文本...');
  const [enabledTypes, setEnabledTypes] = useState<AnalyzeOptions['enabledTypes']>([
    'spelling',
    'punctuation',
    'grammar',
    'fluency',
  ]);
  // Reviewer 开关已移除：由后端 WORKFLOW_PIPELINE 决定

  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [basicList, setBasicList] = useState<ErrorItem[]>([]);
  const [fluentList, setFluentList] = useState<ErrorItem[]>([]);
  const [finalList, setFinalList] = useState<ErrorItem[]>([]); // 最终合并（Reviewer 后或跳过 Reviewer）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleType = (t: AnalyzeOptions['enabledTypes'][number]) => {
    setEnabledTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const onAnalyze = useCallback(async () => {
    setLoading(true);
    setBasicList([]);
    setFluentList([]);
    setFinalList([]);
    setSelectedIds(new Set());

    const options: AnalyzeOptions = {
      enabledTypes,
    };

    try {
      // 取消上一请求
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const result = await analyzeText(
        text,
        options,
        (chunk) => {
          // 流式分栏：basic / fluent / reviewer
          const res = chunk.response?.result ?? [];
          if (chunk.agent === 'basic') {
            setBasicList(res as ErrorItem[]);
          } else if (chunk.agent === 'fluent') {
            setFluentList(res as ErrorItem[]);
          } else if (chunk.agent === 'reviewer') {
            setFinalList(res as ErrorItem[]);
          }
        },
        controller.signal
      );
      // analyzeText 返回最终合并列表（Reviewer on：审阅后；off：直接合并候选）
      setFinalList(result ?? []);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') {
        console.warn('请求已取消');
      } else {
        console.error('analyze error', e);
      }
    } finally {
      setLoading(false);
      if (abortRef.current) {
        abortRef.current = null;
      }
    }
  }, [text, enabledTypes]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 卸载时中止未完成的请求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = useMemo(() => {
    const pool = [...basicList, ...fluentList, ...finalList];
    const byId = new Map(pool.map((x) => [x.id, x]));
    return Array.from(selectedIds)
      .map((id) => byId.get(id))
      .filter(Boolean) as ErrorItem[];
  }, [basicList, fluentList, finalList, selectedIds]);

  const previewText = useMemo(() => {
    if (selectedItems.length === 0) return text;
    return applySelectedEdits(text, selectedItems);
  }, [text, selectedItems]);

  // 预览变化时闪烁提示
  const [flash, setFlash] = useState(false);
  React.useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 850);
    return () => clearTimeout(t);
  }, [previewText]);

  const renderList = (title: string, list: ErrorItem[], tag?: SourceTag) => (
    <div className={styles.card}>
      <div className={styles.card__title}>
        {title}（{list.length}）
      </div>
      <div className={styles.card__list}>
        {list.map((item) => (
          <label
            key={item.id}
            className={cx(styles.item, selectedIds.has(item.id) && styles['item--active'])}
          >
            <input
              className={styles.item__checkbox}
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelect(item.id)}
            />
            <div className={styles.item__body}>
              <div className={styles.item__line}>
                <span style={{ fontWeight: 600 }}>{item.text}</span> →{' '}
                <span style={{ color: '#1e80ff' }}>{item.suggestion}</span>
              </div>
              <div className={styles.item__meta}>
                [{item.start}, {item.end}] • {item.type}{' '}
                {(() => {
                  const src: SourceTag | undefined = tag ?? (item.metadata?.source as SourceTag | undefined);
                  if (!src) return null;
                  const cls = src === 'basic'
                    ? styles['chip--basic']
                    : src === 'fluent'
                    ? styles['chip--fluent']
                    : styles['chip--final'];
                  return <span className={cx(styles.chip, cls)}>{src}</span>;
                })()}
              </div>
              {item.explanation ? (
                <div className={styles.item__desc}>{item.explanation}</div>
              ) : null}
            </div>
          </label>
        ))}
        {list.length === 0 && (
          loading ? (
            <div className={styles.skeleton}>
              <div className={styles.skeleton__row} />
              <div className={styles.skeleton__row} />
              <div className={styles.skeleton__row} />
              <div className={cx(styles.skeleton__row, styles['skeleton__row--short'])} />
            </div>
          ) : (
            <div className={styles.card__empty}>无结果</div>
          )
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.analyzer}>
      <h3 className={styles.analyzer__title}>文本检测 Demo</h3>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className={styles.analyzer__editor}
        placeholder="在此输入要检测的文本"
      />

      <div className={styles.analyzer__toolbar}>
        <div className={styles.analyzer__toggleGroup}>
          <label className={cx(styles.toggle, enabledTypes.includes('spelling') && styles['toggle--active'])}>
            <input
              type="checkbox"
              checked={enabledTypes.includes('spelling')}
              onChange={() => toggleType('spelling')}
            />
            拼写
          </label>
          <label className={cx(styles.toggle, enabledTypes.includes('punctuation') && styles['toggle--active'])}>
            <input
              type="checkbox"
              checked={enabledTypes.includes('punctuation')}
              onChange={() => toggleType('punctuation')}
            />
            标点
          </label>
          <label className={cx(styles.toggle, enabledTypes.includes('grammar') && styles['toggle--active'])}>
            <input
              type="checkbox"
              checked={enabledTypes.includes('grammar')}
              onChange={() => toggleType('grammar')}
            />
            语法
          </label>
          <label className={cx(styles.toggle, enabledTypes.includes('fluency') && styles['toggle--active'])}>
            <input
              type="checkbox"
              checked={enabledTypes.includes('fluency')}
              onChange={() => toggleType('fluency')}
            />
            通顺
          </label>
        </div>

        {/* Reviewer 开关已移除 */}

        <button
          className={styles.btnPrimary}
          onClick={loading ? onCancel : onAnalyze}
          disabled={!loading && text.trim().length === 0}
        >
          {loading ? '取消' : '开始分析'}
        </button>
      </div>

      <div className={styles.columns}>
        {renderList('基础错误（Basic）', basicList, 'basic')}
        {renderList('通顺错误（Fluent）', fluentList, 'fluent')}
        {renderList('最终合并（Final）', finalList)}
      </div>

      <div className={styles.preview}>
        <div className={styles.preview__title}>应用所选后的预览</div>
        <textarea
          value={previewText}
          readOnly
          rows={6}
          className={cx(styles.preview__textarea, flash && styles['preview__textarea--flash'])}
        />
      </div>
    </div>
  );
};

export default AnalyzerPanel;
