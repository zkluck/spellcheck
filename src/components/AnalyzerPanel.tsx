import React, { useCallback, useMemo, useState } from 'react';
import { analyzeText } from '@/lib/langchain';
import type { ErrorItem } from '@/types/error';
import type { AnalyzeOptions } from '@/types/agent';
import { mergeErrors } from '@/lib/langchain/merge';

type AnalyzeOptionsWithReviewer = AnalyzeOptions & { reviewer?: 'on' | 'off' };

type SourceTag = 'basic' | 'fluent';

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
  const [reviewer, setReviewer] = useState<'on' | 'off'>('on');

  const [loading, setLoading] = useState(false);
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

    const options: AnalyzeOptionsWithReviewer = {
      enabledTypes,
      reviewer, // on/off
    };

    try {
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
        }
      );
      // analyzeText 返回最终合并列表（Reviewer on：审阅后；off：直接合并候选）
      setFinalList(result ?? []);
    } catch (e) {
      console.error('analyze error', e);
    } finally {
      setLoading(false);
    }
  }, [text, enabledTypes, reviewer]);

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

  const renderList = (title: string, list: ErrorItem[], tag?: SourceTag) => (
    <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {title}（{list.length}）
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((item) => (
          <label key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelect(item.id)}
            />
            <div style={{ fontSize: 12, lineHeight: 1.4 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{item.text}</span> →{' '}
                <span style={{ color: '#1e80ff' }}>{item.suggestion}</span>
              </div>
              <div style={{ color: '#666' }}>
                [{item.start}, {item.end}] • {item.type}
                {tag ? ` • ${tag}` : item.metadata?.source ? ` • ${item.metadata.source}` : ''}
              </div>
              {item.explanation ? (
                <div style={{ color: '#999' }}>{item.explanation}</div>
              ) : null}
            </div>
          </label>
        ))}
        {list.length === 0 && <div style={{ color: '#999' }}>无结果</div>}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>文本检测 Demo</h3>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        style={{ width: '100%', padding: 8 }}
        placeholder="在此输入要检测的文本"
      />

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div>
          <label>
            <input
              type="checkbox"
              checked={enabledTypes.includes('spelling')}
              onChange={() => toggleType('spelling')}
            />
            拼写
          </label>
          {'  '}
          <label>
            <input
              type="checkbox"
              checked={enabledTypes.includes('punctuation')}
              onChange={() => toggleType('punctuation')}
            />
            标点
          </label>
          {'  '}
          <label>
            <input
              type="checkbox"
              checked={enabledTypes.includes('grammar')}
              onChange={() => toggleType('grammar')}
            />
            语法
          </label>
          {'  '}
          <label>
            <input
              type="checkbox"
              checked={enabledTypes.includes('fluency')}
              onChange={() => toggleType('fluency')}
            />
            通顺
          </label>
        </div>

        <div>
          Reviewer：
          <label>
            <input
              type="radio"
              name="reviewer"
              value="on"
              checked={reviewer === 'on'}
              onChange={() => setReviewer('on')}
            />
            开
          </label>
          {'  '}
          <label>
            <input
              type="radio"
              name="reviewer"
              value="off"
              checked={reviewer === 'off'}
              onChange={() => setReviewer('off')}
            />
            关
          </label>
        </div>

        <button onClick={onAnalyze} disabled={loading}>
          {loading ? '分析中...' : '开始分析'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {renderList('基础错误（Basic）', basicList, 'basic')}
        {renderList('通顺错误（Fluent）', fluentList, 'fluent')}
        {reviewer === 'on' && renderList('最终合并（Final）', finalList)}
      </div>

      <div>
        <div style={{ fontWeight: 600, margin: '12px 0 4px' }}>应用所选后的预览</div>
        <textarea value={previewText} readOnly rows={6} style={{ width: '100%', padding: 8 }} />
      </div>
    </div>
  );
};
