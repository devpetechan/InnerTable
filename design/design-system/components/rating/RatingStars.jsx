import React from 'react';

export function RatingStars({ value = 0, max = 5, size = 15, showValue = true, muted = false }) {
  const stars = [];
  for (let i = 1; i <= max; i++) {
    stars.push(
      <span key={i} style={{ color: (!muted && i <= Math.round(value)) ? 'var(--rating-filled)' : 'var(--rating-empty)' }}>★</span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-ui)' }}>
      <span style={{ fontSize: size, letterSpacing: 1 }}>{stars}</span>
      {showValue && (
        <span style={{ fontWeight: 700, fontSize: size - 1, color: muted ? 'var(--rating-muted-text)' : 'var(--color-ink)' }}>
          {muted ? 'Google ' : ''}{value.toFixed(1)}
        </span>
      )}
    </span>
  );
}
