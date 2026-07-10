import React from 'react';
import { AvatarStack } from '../avatars/AvatarStack';
import { Avatar } from '../avatars/Avatar';
import { StatusChip } from '../chips/StatusChip';
import { RatingStars } from '../rating/RatingStars';
import { Button } from '../buttons/Button';

export function PlaceCard({
  name, metaLine, status = 'recommends', people = [], signalText,
  rating, googleRating, topTake, comments = 0, onAddTake, onOpenComments,
}) {
  const hasTake = !!topTake;
  const isTry = status === 'try';
  return (
    <div style={{
      background: 'var(--color-paper-raised)', border: '1px solid var(--color-border-card)',
      borderRadius: 'var(--radius-xl)', padding: 16, boxShadow: 'var(--shadow-card)',
      fontFamily: 'var(--font-ui)', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--color-ink)', letterSpacing: '-0.01em' }}>{name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 3 }}>{metaLine}</div>
        </div>
        <StatusChip status={status} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <AvatarStack people={people} />
          <span style={{ fontSize: 12.5, color: 'var(--color-secondary)' }}>{signalText}</span>
        </div>
        {rating != null ? (
          <RatingStars value={rating} showValue size={15} />
        ) : googleRating != null ? (
          <RatingStars value={googleRating} muted showValue size={13} />
        ) : null}
      </div>

      {hasTake ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 13, borderTop: '1px solid var(--color-divider)', paddingTop: 13 }}>
          <Avatar initials={topTake.initials} color={topTake.color} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-ink)' }}>{topTake.author}</span>
              {topTake.isPass ? (
                <StatusChip status="pass" />
              ) : (
                <RatingStars value={topTake.rating} size={12} showValue />
              )}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-secondary)', marginTop: 2 }}>“{topTake.note}”</div>
          </div>
        </div>
      ) : isTry ? (
        <div style={{ marginTop: 13, borderTop: '1px solid var(--color-divider)', paddingTop: 13, fontSize: 13, color: 'var(--color-muted)' }}>
          Nobody’s been yet — be the first to try it.
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        {hasTake ? (
          <Button variant="outline" size="sm" onClick={onAddTake}>+ Add your take</Button>
        ) : isTry ? (
          <Button variant="primary" size="sm" onClick={onAddTake}>I’ve been — add a take</Button>
        ) : <span />}
        <span onClick={onOpenComments} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--color-muted)', cursor: 'pointer' }}>
          {comments} comments <span style={{ color: '#B8AFA4', fontSize: 15, lineHeight: 0 }}>›</span>
        </span>
      </div>
    </div>
  );
}
