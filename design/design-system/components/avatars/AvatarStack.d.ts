export interface AvatarStackPerson {
  initials: string;
  color?: string;
}

export interface AvatarStackProps {
  /** Friends to show, in display order. */
  people: AvatarStackPerson[];
  /** Diameter in px of each avatar. */
  size?: number;
  /** How many circles to show before collapsing the rest into a "+N" tail. */
  max?: number;
}

/**
 * @startingPoint section="Components" subtitle="Overlapping avatar stack with +N overflow" viewport="700x120"
 */
export function AvatarStack(props: AvatarStackProps): JSX.Element;
