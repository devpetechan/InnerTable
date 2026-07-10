export interface PlaceCardTopTake {
  author: string;
  initials: string;
  color?: string;
  rating?: number;
  isPass?: boolean;
  note: string;
}

export interface PlaceCardPerson {
  initials: string;
  color?: string;
}

export interface PlaceCardProps {
  name: string;
  /** Dot-joined metadata, e.g. "Restaurant · Italian · $$ · Fort Greene". */
  metaLine: string;
  /** Overall card verdict. */
  status: 'try' | 'recommends' | 'pass' | 'mixed';
  /** Friends behind the signal, for the avatar stack. */
  people: PlaceCardPerson[];
  /** The 1-second-read summary, e.g. "Sam, Ana +3 recommend". */
  signalText: string;
  /** Friend-group average rating. Omit when nobody's been (falls back to googleRating). */
  rating?: number;
  /** Muted fallback rating shown only when `rating` is absent. */
  googleRating?: number;
  /** One representative take surfaced on the card; omit for want-to-try-only places. */
  topTake?: PlaceCardTopTake;
  /** Comment count shown in the footer. */
  comments?: number;
  onAddTake?: () => void;
  onOpenComments?: () => void;
}

/**
 * @startingPoint section="Screens" subtitle="The repeating place card — signal, top take, add/comments footer" viewport="440x340"
 */
export function PlaceCard(props: PlaceCardProps): JSX.Element;
