// A setting's explanation, split the way Field shows it: the first sentence
// on the row, the rest behind "Why?" with the UCI options the control writes.
import type { ReactElement, ReactNode } from 'react';
import { splitHint } from '@/lib/hint';

/** The UCI options a control writes, as a tinkerer would type them. */
function uciLine(options: readonly string[]): ReactElement {
  return (
    <p className="text-muted-foreground">
      {options.length === 1 ? 'UCI option: ' : 'UCI options: '}
      {options.map((o, i) => (
        <span key={o}>
          {i > 0 && ', '}
          <code className="font-mono break-all text-foreground">{o}</code>
        </span>
      ))}
    </p>
  );
}

/**
 * Field's `hint` and `why` from one explanation: its first sentence shows,
 * the rest and the UCI options go behind "Why?". `more` is said after the
 * rest (a live reading, a warning that belongs with the mechanism).
 */
export function explain(text: string, uci: readonly string[], more?: ReactNode): { hint: string; why: ReactNode } {
  const { lead, rest } = splitHint(text);
  return {
    hint: lead,
    why: (
      <div className="flex flex-col gap-1.5">
        {rest !== undefined && <p>{rest}</p>}
        {more}
        {uci.length > 0 && uciLine(uci)}
      </div>
    ),
  };
}
