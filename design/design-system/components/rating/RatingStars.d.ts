export interface RatingStarsProps {
  /** Rating out of `max`, e.g. 4.2. */
  value: number;
  /** Total star count, default 5. */
  max?: number;
  /** Star glyph size in px. */
  size?: number;
  /** Show the numeric value next to the stars. */
  showValue?: boolean;
  /** Render as the muted Google-rating fallback (used when nobody in the group has been). */
  muted?: boolean;
}

/**
 * @startingPoint section="Components" subtitle="Clay star rating, with a muted Google-fallback mode" viewport="700x100"
 */
export function RatingStars(props: RatingStarsProps): JSX.Element;
