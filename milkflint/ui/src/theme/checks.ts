// The contrast every theme's colours must reach (WCAG 2.2 AA), as pairs of
// roles: the tests hold every built-in theme to them, and the Themes page's
// editor checks a custom theme against the same list as you change it.
import { contrast } from './color.ts';
import type { ColorToken, Theme } from './contract.ts';

// [text, on] pairs that must reach 4.5:1 (WCAG 2.2 AA, normal text).
export const TEXT_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'popover'],
  ['foreground', 'muted'],
  ['foreground', 'selection'],
  ['foreground', 'primary-subtle'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'popover'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['primary', 'card'],
  ['primary', 'background'],
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['primary-subtle-foreground', 'primary-subtle'],
  ...(['success', 'warning', 'destructive', 'info'] as const).flatMap((s): (readonly [ColorToken, ColorToken])[] => [
    [s, 'card'],
    [s, 'background'],
    [s, `${s}-subtle`],
    [`${s}-foreground`, s],
    ['foreground', `${s}-subtle`],
  ]),
  ['chart-axis', 'card'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-muted-foreground', 'sidebar'],
  ['sidebar-foreground', 'sidebar-accent'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
];

// [mark, on] pairs for controls and graphics: 3:1 (WCAG 2.2 AA, 1.4.11).
export const MARK_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['input', 'card'],
  ['input', 'background'],
  ['input', 'popover'],
  ['ring', 'card'],
  ['ring', 'background'],
  ['sidebar-ring', 'sidebar'],
  ['primary', 'muted'],
  ['ramp-5', 'card'],
  ...([1, 2, 3, 4, 5, 6] as const).map((n): readonly [ColorToken, ColorToken] => [`chart-${n}`, 'card']),
];

export interface ContrastFailure {
  fg: ColorToken;
  bg: ColorToken;
  ratio: number;
  /** 4.5 for text, 3 for controls and chart marks */
  min: number;
}

/** The text contrast a theme holds to: 4.5:1 (AA), or 7:1 when it asks for AAA. */
export function textMinimum(theme: Pick<Theme, 'contrast'>): 4.5 | 7 {
  return theme.contrast === 'AAA' ? 7 : 4.5;
}

/** Every pair below its minimum, in the scheme's colours; `textMin` for the text pairs. */
export function contrastFailures(color: Readonly<Record<ColorToken, string>>, textMin = 4.5): ContrastFailure[] {
  const out: ContrastFailure[] = [];
  for (const [pairs, min] of [
    [TEXT_PAIRS, textMin],
    [MARK_PAIRS, 3],
  ] as const) {
    for (const [fg, bg] of pairs) {
      const ratio = contrast(color[fg], color[bg]);
      if (ratio < min) out.push({ fg, bg, ratio, min });
    }
  }
  return out;
}
