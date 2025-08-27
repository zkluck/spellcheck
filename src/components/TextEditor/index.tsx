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
  const editorRef = useRef<HTMLDivElement | null>(null);

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

      // 为所有错误类型添加高亮
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
    const textarea = e.target as HTMLTextAreaElement;
    const top = textarea.scrollTop;
    const left = textarea.scrollLeft;
    setScrollTop(top);
    
    // 立即同步背景层滚动
    if (highlightsRef.current) {
      highlightsRef.current.style.transform = `translate(-${left}px, -${top}px)`;
    }
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

  // 动态计算滚动条宽度并同步
  useEffect(() => {
    const textarea = textareaRef.current;
    const backdrop = highlightsRef.current?.parentElement;
    if (!textarea || !backdrop) return;

    const updateScrollbarWidth = () => {
      // 计算实际滚动条宽度
      const scrollbarWidth = textarea.offsetWidth - textarea.clientWidth;
      backdrop.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
    };

    updateScrollbarWidth();
    
    // 监听内容变化重新计算
    const resizeObserver = new ResizeObserver(updateScrollbarWidth);
    resizeObserver.observe(textarea);

    return () => resizeObserver.disconnect();
  }, [value]);

  return (
    <div className={cn('text-editor')} ref={editorRef}>
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
          >
            {renderWithHighlight}
          </div>
        </div>
      </div>

    </div>
  );
}
