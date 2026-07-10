import React from 'react';

const BASE = {
  fontFamily: 'var(--font-ui)', fontWeight: 700, border: 'none', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};

const SIZES = {
  md: { fontSize: 14.5, padding: '13px 20px', borderRadius: 12 },
  sm: { fontSize: 12.5, padding: '8px 14px', borderRadius: 9 },
};

const VARIANTS = {
  primary: { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 6px 16px rgba(193,85,46,.24)' },
  outline: { background: '#fff', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', boxShadow: 'none' },
  ghost: { background: 'transparent', color: 'var(--color-secondary)', border: '1px solid var(--color-border-input)', boxShadow: 'none' },
  fab: { background: 'var(--color-accent)', color: '#fff', borderRadius: 999, padding: '14px 22px', boxShadow: 'var(--shadow-fab)', fontSize: 15 },
};

export function Button({ variant = 'primary', size = 'md', children, icon, style, ...rest }) {
  const s = variant === 'fab'
    ? { ...BASE, ...VARIANTS.fab }
    : { ...BASE, ...SIZES[size], ...VARIANTS[variant] };
  return (
    <button style={{ ...s, ...style }} {...rest}>
      {icon && <span style={{ fontSize: '1.3em', lineHeight: 0, marginTop: -1 }}>{icon}</span>}
      {children}
    </button>
  );
}
