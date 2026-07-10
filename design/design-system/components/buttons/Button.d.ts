import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = filled clay pill (main CTA). outline = clay outline on white. ghost = neutral outline, low emphasis. fab = pill-shaped floating action button. */
  variant?: 'primary' | 'outline' | 'ghost' | 'fab';
  /** md (default) or sm (footer/inline actions). Ignored for `fab`. */
  size?: 'md' | 'sm';
  /** Optional leading glyph, e.g. "+". */
  icon?: React.ReactNode;
}

/**
 * @startingPoint section="Components" subtitle="Primary clay / outline / ghost / floating action button" viewport="700x140"
 */
export function Button(props: ButtonProps): JSX.Element;
