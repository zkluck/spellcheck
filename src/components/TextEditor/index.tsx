'use client';

import React, { useMemo } from 'react';
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

  return (
    <div className={cn('text-editor')}>
      <div className={cn('text-editor__container')}>
        <textarea
          className={cn('text-editor__input')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck="false"
          placeholder="请输入需要检测的中文文本..."
        />
        <div className={cn('text-editor__backdrop')}>
          <div className={cn('text-editor__highlights')}>{renderWithHighlight}</div>
        </div>
      </div>
      <div className={cn('text-editor__info')}>
        <span className={cn('text-editor__char-count')}>{value.length} 字符</span>
      </div>
    </div>
  );
}
