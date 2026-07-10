import React from 'react';

const VARIANTS = {
  try: { bg: 'var(--status-try-bg)', text: 'var(--status-try-text)', dot: 'var(--status-try-dot)', label: 'Want to Try' },
  recommends: { bg: 'var(--status-rec-bg)', text: 'var(--status-rec-text)', dot: 'var(--status-rec-dot)', label: 'Recommends' },
  pass: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass-text)', dot: 'var(--status-pass-dot)', label: 'Hard Pass' },
  mixed: { bg: 'var(--status-mixed-bg)', text: 'var(--status-mixed-text)', dot: null, label: 'Mixed' },
};

export function StatusChip({ status = 'recommends', label }) {
  const v = VARIANTS[status] || VARIANTS.recommends;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: v.bg, color: v.text, fontFamily: 'var(--font-ui)',
      fontWeight: 600, fontSize: 12.5, padding: '5px 11px', borderRadius: 7,
      border: status === 'mixed' ? '1px solid var(--status-mixed-border)' : 'none',
      whiteSpace: 'nowrap',
    }}>
      {v.dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: v.dot }} />}
      {label || v.label}
    </span>
  );
}
