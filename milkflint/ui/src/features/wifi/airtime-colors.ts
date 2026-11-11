// The colour of each airtime class, the same wherever one is shown: the card's
// bar, list and last minute (airtime-card.tsx) and the band's table of
// classes (airtime-bands.tsx). Blue, amber and red stay apart for red-green
// colour-blind eyes too, which the theme's green beside its amber or red
// wouldn't; a device that doesn't answer has the text colour, the strongest
// there is. The amber is a lighter step of the theme's (darker in dark mode),
// which sets it further from the red.
import type { AirtimeClass } from './airtime';

export const airtimeFill: Record<AirtimeClass, string> = {
  full: 'bg-chart-2',
  slow: 'bg-warning/75 dark:bg-warning/60',
  weak: 'bg-destructive',
  lost: 'bg-foreground',
};
