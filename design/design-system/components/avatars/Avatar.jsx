import React from 'react';

const PALETTE = ['var(--avatar-1)', 'var(--avatar-2)', 'var(--avatar-3)', 'var(--avatar-4)', 'var(--avatar-5)'];

export function Avatar({ initials = '??', color, size = 34, ringColor = 'var(--color-paper-raised)', ring = 0 }) {
  const bg = color || PALETTE[(initials.charCodeAt(0) || 0) % PALETTE.length];
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      color: '#fff', fontFamily: 'var(--font-ui)', fontWeight: 700,
      fontSize: Math.round(size * 0.38), display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', flex: 'none',
      border: ring ? `${ring}px solid ${ringColor}` : 'none', boxSizing: 'border-box',
    }}>
      {initials}
    </span>
  );
}
