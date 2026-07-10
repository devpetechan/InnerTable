export interface AvatarProps {
  /** Two-letter initials shown in the circle. */
  initials: string;
  /** Explicit fill color; otherwise auto-picked from the avatar palette by initial. */
  color?: string;
  /** Diameter in px. List rows use 34, stacked-on-card uses 26, top-take uses 28. */
  size?: number;
  /** Border color when `ring` is set (used when avatars overlap on a paper card). */
  ringColor?: string;
  /** Border width in px; 2 when stacked with overlap, 0 standalone. */
  ring?: number;
}

/**
 * @startingPoint section="Components" subtitle="Circular colored-initials avatar" viewport="700x120"
 */
export function Avatar(props: AvatarProps): JSX.Element;
