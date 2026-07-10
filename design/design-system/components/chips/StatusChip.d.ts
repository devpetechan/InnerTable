export interface StatusChipProps {
  /** Which take/verdict this chip represents. */
  status: 'try' | 'recommends' | 'pass' | 'mixed';
  /** Override the default label text. */
  label?: string;
}

/**
 * @startingPoint section="Components" subtitle="Tinted status pill — Want to Try / Recommends / Hard Pass / Mixed" viewport="700x120"
 */
export function StatusChip(props: StatusChipProps): JSX.Element;
