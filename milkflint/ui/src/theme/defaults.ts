// The settings a theme takes when it changes nothing about them: how the
// interface looked before themes could say otherwise.
import type { ChartTokens, PresentationTokens } from './contract.ts';

export const standardPresentation = {
  explanations: 'shown',
  decorativeIcons: 'shown',
  linkUnderline: 'hover',
  stateMarks: 'dot',
  navCurrent: 'fill',
} as const satisfies PresentationTokens;

export const solidCharts = {
  dash: { 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none' },
} as const satisfies ChartTokens;
