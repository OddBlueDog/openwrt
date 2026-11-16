// Custom themes: made on the Themes page from a built-in theme by changing
// some of its colours, and kept on the router with the theme in use. A
// custom theme stores only the colours it changed, as #rrggbb, so it takes
// everything else (type, shape, layout, Home's widgets, the colours it left
// alone) from its base.
//
// Plain data like the rest of src/theme: no browser APIs, so the tests run it.
import { mix, shiftLightness, toHex } from './color.ts';
import { COLOR_TOKENS, type ColorToken, type Scheme, type Theme } from './contract.ts';
import { schemesOf } from './css.ts';

export type SchemeName = 'light' | 'dark';
export type ColorChanges = Partial<Record<ColorToken, string>>;

export interface CustomTheme {
  /** custom-…, unique among custom themes */
  id: string;
  name: string;
  /** The built-in theme it starts from. */
  base: string;
  colors: Record<SchemeName, ColorChanges>;
}

/** What the router keeps: the theme every device shows, and the custom themes. */
export interface ThemeSettings {
  /** null: the default */
  theme: string | null;
  custom: CustomTheme[];
}

export const CUSTOM_PREFIX = 'custom-';
export const MAX_CUSTOM = 24;
export const NAME_MAX = 40;
const HEX = /^#[0-9a-f]{6}$/i;
const CUSTOM_ID = /^custom-[a-z0-9-]{1,40}$/;
const THEME_ID = /^[a-z][a-z0-9-]{0,47}$/;

/** Every colour a custom theme may change: all but the dimming behind dialogs, which isn't a surface. */
export const EDITABLE: readonly ColorToken[] = COLOR_TOKENS.filter((t) => t !== 'scrim');
const editable = new Set<string>(EDITABLE);

export function isCustomId(id: string): boolean {
  return CUSTOM_ID.test(id);
}

function changesFrom(raw: unknown): ColorChanges {
  const out: ColorChanges = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [token, value] of Object.entries(raw)) {
    if (editable.has(token) && typeof value === 'string' && HEX.test(value)) out[token as ColorToken] = value.toLowerCase();
  }
  return out;
}

/**
 * The router's reply, as far as it makes sense: a custom theme with a bad id
 * or name is left out, and a colour that isn't #rrggbb is dropped, so nothing
 * odd reaches the CSS.
 */
export function parseSettings(raw: unknown): ThemeSettings {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const theme = typeof o['theme'] === 'string' && THEME_ID.test(o['theme']) ? o['theme'] : null;
  const custom: CustomTheme[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(o['custom']) ? o['custom'] : []) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const id = c['id'];
    const name = typeof c['name'] === 'string' ? c['name'].trim() : '';
    const base = c['base'];
    if (typeof id !== 'string' || !CUSTOM_ID.test(id) || seen.has(id)) continue;
    if (name === '' || name.length > NAME_MAX || typeof base !== 'string' || !THEME_ID.test(base)) continue;
    const colors = typeof c['colors'] === 'object' && c['colors'] !== null ? (c['colors'] as Record<string, unknown>) : {};
    seen.add(id);
    custom.push({ id, name, base, colors: { light: changesFrom(colors['light']), dark: changesFrom(colors['dark']) } });
    if (custom.length === MAX_CUSTOM) break;
  }
  return { theme, custom };
}

/** A new custom theme's id, from its name, unlike any taken. */
export function newCustomId(name: string, taken: readonly string[]): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const stem = slug === '' ? 'theme' : slug;
  let id = `${CUSTOM_PREFIX}${stem}`;
  for (let n = 2; taken.includes(id); n++) id = `${CUSTOM_PREFIX}${stem}-${String(n)}`;
  return id;
}

function withChanges(scheme: Scheme, changes: ColorChanges): Scheme {
  // a raised-contrast colour from the base would undo a change, so it's kept only for colours left alone
  const more = Object.fromEntries(Object.entries(scheme.more ?? {}).filter(([token]) => !(token in changes)));
  const color = { ...scheme.color, ...changes };
  return Object.keys(more).length > 0 ? { color, elevation: scheme.elevation, more } : { color, elevation: scheme.elevation };
}

/** The base theme to use: the one named, or the first built-in if it's gone. */
export function baseOf(custom: Pick<CustomTheme, 'base'>, builtIn: readonly Theme[]): Theme {
  const theme = builtIn.find((t) => t.id === custom.base) ?? builtIn[0];
  if (theme === undefined) throw new Error('no built-in theme');
  return theme;
}

/** The custom theme as a whole theme: its base with its colours changed. */
export function resolveCustom(custom: CustomTheme, builtIn: readonly Theme[]): Theme {
  const base = baseOf(custom, builtIn);
  const { light, dark } = schemesOf(base);
  return {
    ...base,
    id: custom.id,
    name: custom.name,
    description: `Your own, from ${base.name}.`,
    hidden: false,
    schemes: { light: withChanges(light, custom.colors.light), dark: withChanges(dark, custom.colors.dark) },
  };
}

/** One scheme's colours with the changes made so far. */
export function colorsOf(base: Theme, scheme: SchemeName, changes: ColorChanges): Record<ColorToken, string> {
  return { ...schemesOf(base)[scheme].color, ...changes };
}

// The editor's main colours. Each sets its own role and the ones that go
// with it, so a theme changed in a few picks still hangs together: a new
// accent brings its hover, tints, focus rings and the "how much" ramp.
type Derive = (value: string, scheme: SchemeName, colors: Readonly<Record<ColorToken, string>>) => ColorChanges;

export interface MainColor {
  token: ColorToken;
  label: string;
  hint: string;
  derive: Derive;
}

const light = (s: SchemeName): boolean => s === 'light';

const accent: Derive = (v, s, c) => {
  const subtle = mix(v, c.card, light(s) ? 0.9 : 0.78);
  const subtleText = shiftLightness(v, light(s) ? -0.14 : 0.15);
  return {
    primary: v,
    'primary-hover': shiftLightness(v, light(s) ? -0.06 : 0.05),
    'primary-subtle': subtle,
    'primary-subtle-foreground': subtleText,
    ring: v,
    'sidebar-ring': v,
    'sidebar-primary': mix(v, c.sidebar, light(s) ? 0.9 : 0.78),
    'sidebar-primary-foreground': subtleText,
    selection: mix(v, c.card, light(s) ? 0.8 : 0.62),
    // from barely there to deep, on the panel's side of the scale first
    'ramp-1': mix(v, c.card, 0.8),
    'ramp-2': mix(v, c.card, 0.6),
    'ramp-3': mix(v, c.card, 0.3),
    'ramp-4': v,
    'ramp-5': shiftLightness(v, light(s) ? -0.14 : 0.15),
  };
};

const status =
  (token: 'success' | 'warning' | 'destructive' | 'info'): Derive =>
  (v, s, c) => ({ [token]: v, [`${token}-subtle`]: mix(v, c.card, light(s) ? 0.9 : 0.8) });

export const MAIN_COLORS: readonly MainColor[] = [
  { token: 'primary', label: 'Accent', hint: 'Buttons, links, the page you’re on, focus rings.', derive: accent },
  { token: 'background', label: 'Page', hint: 'Behind the panels.', derive: (v) => ({ background: v }) },
  { token: 'card', label: 'Panels', hint: 'Cards, menus and sheets.', derive: (v) => ({ card: v, popover: v }) },
  {
    token: 'muted',
    label: 'Quiet surfaces',
    hint: 'Table headings, hovered rows, wells.',
    derive: (v) => ({ muted: v, secondary: v, accent: v }),
  },
  {
    token: 'foreground',
    label: 'Text',
    hint: 'Headings and the main text.',
    derive: (v) => ({
      foreground: v,
      'card-foreground': v,
      'popover-foreground': v,
      'secondary-foreground': v,
      'accent-foreground': v,
      'sidebar-accent-foreground': v,
    }),
  },
  {
    token: 'muted-foreground',
    label: 'Secondary text',
    hint: 'Hints, labels and chart axes.',
    derive: (v) => ({ 'muted-foreground': v, 'chart-axis': v, 'sidebar-muted-foreground': v }),
  },
  { token: 'sidebar', label: 'Menu', hint: 'The menu’s own surface.', derive: (v) => ({ sidebar: v }) },
  {
    token: 'sidebar-foreground',
    label: 'Menu text',
    hint: 'The menu’s items.',
    derive: (v) => ({ 'sidebar-foreground': v }),
  },
  {
    token: 'border',
    label: 'Lines',
    hint: 'Card edges, dividers, chart grids.',
    derive: (v) => ({ border: v, 'sidebar-border': v, 'chart-grid': v }),
  },
  { token: 'input', label: 'Form borders', hint: 'Around fields and switches.', derive: (v) => ({ input: v }) },
];

export const STATUS_COLORS: readonly MainColor[] = [
  { token: 'success', label: 'Good', hint: 'Online, on, passed.', derive: status('success') },
  { token: 'warning', label: 'Warning', hint: 'Needs a look.', derive: status('warning') },
  { token: 'destructive', label: 'Problem', hint: 'Down, failed, delete.', derive: status('destructive') },
  { token: 'info', label: 'Information', hint: 'Notes and tips.', derive: status('info') },
];

/** What each colour role is, for the editor's full list and its contrast report. */
export const TOKEN_LABELS: Readonly<Record<ColorToken, string>> = {
  background: 'Page',
  foreground: 'Text',
  card: 'Panels',
  'card-foreground': 'Text on panels',
  popover: 'Menus and sheets',
  'popover-foreground': 'Text on menus',
  muted: 'Quiet surfaces',
  'muted-foreground': 'Secondary text',
  secondary: 'Quiet buttons',
  'secondary-foreground': 'Text on quiet buttons',
  accent: 'Hovered rows',
  'accent-foreground': 'Text on hovered rows',
  primary: 'Accent',
  'primary-hover': 'Accent, hovered',
  'primary-foreground': 'Text on the accent',
  'primary-subtle': 'Accent tint',
  'primary-subtle-foreground': 'Text on the accent tint',
  success: 'Good',
  'success-foreground': 'Text on good',
  'success-subtle': 'Good tint',
  warning: 'Warning',
  'warning-foreground': 'Text on warning',
  'warning-subtle': 'Warning tint',
  destructive: 'Problem',
  'destructive-foreground': 'Text on problem',
  'destructive-subtle': 'Problem tint',
  info: 'Information',
  'info-foreground': 'Text on information',
  'info-subtle': 'Information tint',
  border: 'Lines',
  rule: 'Strong lines',
  input: 'Form borders',
  ring: 'Focus ring',
  selection: 'Selected text',
  scrim: 'Dimming behind dialogs',
  sidebar: 'Menu',
  'sidebar-foreground': 'Menu text',
  'sidebar-muted-foreground': 'Menu secondary text',
  'sidebar-accent': 'Menu, hovered',
  'sidebar-accent-foreground': 'Menu text, hovered',
  'sidebar-primary': 'Menu, current page',
  'sidebar-primary-foreground': 'Menu text, current page',
  'sidebar-border': 'Menu lines',
  'sidebar-ring': 'Menu focus ring',
  'chart-1': 'Chart 1 (upload)',
  'chart-2': 'Chart 2 (download)',
  'chart-3': 'Chart 3',
  'chart-4': 'Chart 4',
  'chart-5': 'Chart 5',
  'chart-6': 'Chart 6',
  'chart-grid': 'Chart grid',
  'chart-axis': 'Chart axis text',
  'ramp-1': 'Amount, least',
  'ramp-2': 'Amount, low',
  'ramp-3': 'Amount, middle',
  'ramp-4': 'Amount, high',
  'ramp-5': 'Amount, most',
  'brand-stone': 'Logo stone',
  'brand-milk': 'Logo milk',
};

/** The full list in groups, in the order a person thinks of them. */
export const TOKEN_GROUPS: readonly { title: string; tokens: readonly ColorToken[] }[] = [
  {
    title: 'Surfaces and text',
    tokens: [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'popover-foreground',
      'muted',
      'muted-foreground',
      'secondary',
      'secondary-foreground',
      'accent',
      'accent-foreground',
      'selection',
    ],
  },
  {
    title: 'Accent',
    tokens: ['primary', 'primary-hover', 'primary-foreground', 'primary-subtle', 'primary-subtle-foreground', 'ring'],
  },
  {
    title: 'States',
    tokens: [
      'success',
      'success-foreground',
      'success-subtle',
      'warning',
      'warning-foreground',
      'warning-subtle',
      'destructive',
      'destructive-foreground',
      'destructive-subtle',
      'info',
      'info-foreground',
      'info-subtle',
    ],
  },
  { title: 'Lines', tokens: ['border', 'rule', 'input'] },
  {
    title: 'Menu',
    tokens: [
      'sidebar',
      'sidebar-foreground',
      'sidebar-muted-foreground',
      'sidebar-accent',
      'sidebar-accent-foreground',
      'sidebar-primary',
      'sidebar-primary-foreground',
      'sidebar-border',
      'sidebar-ring',
    ],
  },
  {
    title: 'Charts',
    tokens: [
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'chart-6',
      'chart-grid',
      'chart-axis',
      'ramp-1',
      'ramp-2',
      'ramp-3',
      'ramp-4',
      'ramp-5',
    ],
  },
  { title: 'Logo', tokens: ['brand-stone', 'brand-milk'] },
];

/**
 * The changes after picking `value` for a main colour: its own role and the
 * ones that go with it, worked out from the scheme as it stands. Values that
 * end up the same as the base drop out, so "changed" stays honest.
 */
export function pickMain(main: MainColor, value: string, scheme: SchemeName, base: Theme, changes: ColorChanges): ColorChanges {
  const now = colorsOf(base, scheme, changes);
  const next: ColorChanges = { ...changes, ...main.derive(value, scheme, now) };
  return withoutUnchanged(base, scheme, next);
}

/** One role set directly (the full list). */
export function pickOne(token: ColorToken, value: string, scheme: SchemeName, base: Theme, changes: ColorChanges): ColorChanges {
  return withoutUnchanged(base, scheme, { ...changes, [token]: value });
}

function withoutUnchanged(base: Theme, scheme: SchemeName, changes: ColorChanges): ColorChanges {
  const original = schemesOf(base)[scheme].color;
  return Object.fromEntries(
    Object.entries(changes).filter(([token, value]) => toHex(original[token as ColorToken]) !== value.toLowerCase()),
  );
}
