'use client';

import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import classnames from 'classnames/bind';
import { ErrorItem } from '@/types/error';
import styles from './index.module.scss';

const cn = classnames.bind(styles);

interface TextEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors: ErrorItem[];
  activeErrorId: string | null;
  onSelectError: (id: string | null) => void;
}

// This component uses a common pattern for highlighting text in a textarea.
// It renders a div that looks like a textarea, with the text content
// styled using spans. An actual, invisible textarea is layered underneath
// to handle the text input.
export default function TextEditor({
  value,
  onChange,
  errors,
  activeErrorId,
  onSelectError,
}: TextEditorProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightsRef = useRef<HTMLDivElement | null>(null);
  const spanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const [scrollTop, setScrollTop] = useState(0);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // 兼容性处理：创建临时文本区域复制
        const temp = document.createElement('textarea');
        temp.value = value;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Copy failed:', e);
    }
  }, [value]);

  const renderWithHighlight = useMemo(() => {
    if (errors.length === 0) {
      return value;
    }

    const sortedErrors = [...errors].sort((a, b) => a.start - b.start);
    const parts = [];
    let lastIndex = 0;

    sortedErrors.forEach((error) => {
      // Add text before the error
      if (error.start > lastIndex) {
        parts.push(value.substring(lastIndex, error.start));
      }

      // Add the highlighted error text
      parts.push(
        <span
          key={error.id}
          className={cn('highlight', `highlight--${error.type}`, {
            'highlight--active': error.id === activeErrorId,
          })}
          ref={(el) => {
            if (!el) {
              spanRefs.current.delete(error.id);
            } else {
              spanRefs.current.set(error.id, el);
            }
          }}
          onClick={() => onSelectError(error.id)}
        >
          {value.substring(error.start, error.end)}
        </span>
      );

      lastIndex = error.end;
    });

    // Add any remaining text after the last error
    if (lastIndex < value.length) {
      parts.push(value.substring(lastIndex));
    }

    return parts;
  }, [value, errors, activeErrorId, onSelectError]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const top = (e.target as HTMLTextAreaElement).scrollTop;
    setScrollTop(top);
  }, []);

  // 当选中错误变化时，自动滚动定位
  useEffect(() => {
    if (!activeErrorId) return;
    const ta = textareaRef.current;
    const el = spanRefs.current.get(activeErrorId);
    if (!ta || !el) return;
    const desired = Math.max(el.offsetTop - 60, 0);
    try {
      ta.scrollTo({ top: desired, behavior: 'smooth' });
    } catch {
      ta.scrollTop = desired;
    }
  }, [activeErrorId]);

  return (
    <div className={cn('text-editor')}>
      <div className={cn('text-editor__container')}>
        <textarea
          className={cn('text-editor__input')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          ref={textareaRef}
          spellCheck="false"
          placeholder="请输入需要检测的中文文本..."
        />
        <div className={cn('text-editor__backdrop')}>
          <div
            className={cn('text-editor__highlights')}
            ref={highlightsRef}
            style={{ transform: `translateY(-${scrollTop}px)` }}
          >
            {renderWithHighlight}
          </div>
        </div>
      </div>
      <div className={cn('text-editor__info')}>
        <span className={cn('text-editor__char-count')}>{value.length} 字符</span>
        <button
          type="button"
          className={cn('text-editor__copy-button')}
          onClick={handleCopy}
          aria-label="复制文本"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
}
