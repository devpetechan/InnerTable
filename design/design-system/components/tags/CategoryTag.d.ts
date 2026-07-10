import React from 'react';

export interface CategoryTagProps {
  /** Tag text — Restaurant/Bar, cuisine, price ($–$$$$), or neighborhood. */
  children: React.ReactNode;
}

/**
 * @startingPoint section="Components" subtitle="Outline metadata pill — type, cuisine, price, neighborhood" viewport="700x90"
 */
export function CategoryTag(props: CategoryTagProps): JSX.Element;
