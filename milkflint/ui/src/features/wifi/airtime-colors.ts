// The colour of each airtime class, the same wherever one is shown: the card's
// bar, list and last minute (airtime-card.tsx) and the band's table of
// classes (airtime-bands.tsx). The theme's action, warning and danger
// colours, each with the text colour the theme tests against it; a device
// that doesn't answer has the text colour, the strongest there is. The
// legend and the list name each class, so colour never says it alone.
import type { AirtimeClass } from './airtime';

export const airtimeFill: Record<AirtimeClass, string> = {
  full: 'bg-primary',
  slow: 'bg-warning',
  weak: 'bg-destructive',
  lost: 'bg-foreground',
};

/** The same colours as values, for the last minute's chart */
export const airtimeColor: Record<AirtimeClass, string> = {
  full: 'var(--primary)',
  slow: 'var(--warning)',
  weak: 'var(--destructive)',
  lost: 'var(--foreground)',
};
