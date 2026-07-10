import React from 'react';

export function CategoryTag({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--color-secondary)',
      border: '1px solid var(--color-border-tag)', padding: '4px 10px',
      borderRadius: 7, whiteSpace: 'nowrap', display: 'inline-block',
    }}>
      {children}
    </span>
  );
}
