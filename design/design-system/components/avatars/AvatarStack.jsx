import React from 'react';
import { Avatar } from './Avatar';

export function AvatarStack({ people = [], size = 26, max = 3 }) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <div style={{ display: 'flex', paddingLeft: 8 }}>
      {shown.map((p, i) => (
        <div key={p.initials + i} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <Avatar initials={p.initials} color={p.color} size={size} ring={2} />
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ marginLeft: -8 }}>
          <span style={{
            width: size, height: size, borderRadius: '50%', background: 'var(--color-canvas)',
            color: 'var(--color-secondary)', fontFamily: 'var(--font-ui)', fontWeight: 700,
            fontSize: Math.round(size * 0.36), display: 'flex', alignItems: 'center',
            justifyContent: 'center', border: '2px solid var(--color-paper-raised)', boxSizing: 'border-box',
          }}>+{overflow}</span>
        </div>
      )}
    </div>
  );
}
