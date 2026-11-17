// The theme contract: every token a theme defines, and nothing else.
//
// Three tiers. Primitives (primitives.ts) are raw values: OKLCH colour ramps
// and scales, never used by components. Semantic tokens (this file) name a
// role, such as the page's background or a warning's text; a theme maps each
// one to a value, and components use only these, through Tailwind classes
// (bg-card, text-muted-foreground, rounded-lg, h-9) or var(--name) in SVG.
// Component tokens are few, here as the layout and shell values a component
// needs its own knob for.
//
// The colour names follow shadcn/ui's convention (background, card, primary,
// muted-foreground…), so a theme made for it maps across, with MilkFlint's
// additions for status surfaces, the side rail, charts and the logo.
//
// This module is plain data: Vite's config imports it to write the CSS, and
// the tests import it to check every theme. No browser APIs, no '@/' imports.

/** Colour roles. Each scheme of each theme gives every one a value. */
export const COLOR_TOKENS = [
  // the page and the text on it
  'background',
  'foreground',
  // panels (cards), and what floats above them (menus, popovers, sheets)
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  // quiet surfaces (table headers, wells) and secondary text, which must
  // still read at 4.5:1 on every surface
  'muted',
  'muted-foreground',
  'secondary',
  'secondary-foreground',
  // hover and selected backgrounds for list items and quiet buttons
  'accent',
  'accent-foreground',
  // the one action colour: primary buttons, links, selection, focus
  'primary',
  'primary-hover',
  'primary-foreground',
  'primary-subtle',
  'primary-subtle-foreground',
  // states: a strong colour (text on surfaces, or a fill under -foreground)
  // and a tinted surface for notices and badges (its text is the strong one)
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
  // lines: dividers, a stronger rule, form control borders (3:1, they mark
  // the control), the focus ring
  'border',
  'rule',
  'input',
  'ring',
  'selection',
  'scrim',
  // the side rail (or top bar): its own surface, so a theme can colour it
  'sidebar',
  'sidebar-foreground',
  'sidebar-muted-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-border',
  'sidebar-ring',
  // data: categorical series (traffic charts draw download in 2 and upload
  // in 1, so that pair stays furthest apart), grid and axis text,
  // and one stepped ramp for "how much" (traffic, signal, airtime)
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
  // the logo's stone and milk
  'brand-stone',
  'brand-milk',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Shadows depend on the scheme (a dark page needs darker, stronger ones). */
export const ELEVATION_TOKENS = ['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg'] as const;
export type ElevationToken = (typeof ELEVATION_TOKENS)[number];

export interface Scheme {
  color: Readonly<Record<ColorToken, string>>;
  elevation: Readonly<Record<ElevationToken, string>>;
  /** Overrides under prefers-contrast: more. */
  more?: Readonly<Partial<Record<ColorToken, string>>>;
}

/** Type sizes, each with its line height: the Tailwind text-* classes. */
export const TEXT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface TypeTokens {
  /** The UI face, as a CSS font-family list. */
  sans: string;
  /** Addresses, keys, code: a monospace list. */
  mono: string;
  scale: Readonly<Record<TextSize, { size: string; leading: string }>>;
}

export const RADII = ['sm', 'md', 'lg', 'xl'] as const;
export type Radius = (typeof RADII)[number];

export interface ShapeTokens {
  radius: Readonly<Record<Radius, string>>;
}

export interface DensityTokens {
  /**
   * The spacing unit every Tailwind size and gap is a multiple of (p-4 is
   * four of them). Smaller is denser: controls, rows and gaps shrink together.
   */
  space: string;
}

export interface MotionTokens {
  fast: string;
  base: string;
  slow: string;
  /** Ordinary state changes. */
  standard: string;
  /** Things arriving: menus, sheets, toasts. */
  enter: string;
}

/** Where things sit. Read by the shell and Home, not only by CSS. */
export interface LayoutTokens {
  /** The menu as a rail at the side, or a bar along the top. */
  shell: 'side' | 'top';
  /**
   * The top bar's tools (search, LuCI, light or dark, log out): 'full' on a
   * row of their own above the menu, or 'compact', as icon buttons at the end
   * of a single row with the menu.
   */
  tools: 'full' | 'compact';
  /** Which side the rail is on, when shell is 'side'. */
  railSide: 'left' | 'right';
  navWidth: string;
  /** The widest the page's content grows. */
  contentMax: string;
  /** Space around the page's content. */
  gutter: string;
}

/** A widget's size on Home: columns of four (fewer on a narrower screen) and rows. */
export interface WidgetSize {
  readonly w: 1 | 2 | 3 | 4;
  readonly h: 1 | 2;
}

/** One of Home's widgets, by id (src/features/dashboard/widgets.tsx), at a size. */
export interface DashboardWidget {
  readonly id: string;
  readonly size: WidgetSize;
}

/**
 * Home's widgets until the user arranges their own: which show, in order, at
 * what size. The user's own layout, once saved, is used in every theme.
 */
export interface DashboardLayout {
  readonly widgets: readonly DashboardWidget[];
}

/**
 * How much the interface says and shows beyond what's needed. Read by the
 * shared components (Field, the headers, Home's widgets, the menu, badges).
 */
export interface PresentationTokens {
  /**
   * Page, card and widget descriptions, setting hints and "Why?": 'shown' as
   * they are, or 'on-request' behind a "?" beside the title or label they
   * belong to. Live state, errors and warnings show either way.
   */
  explanations: 'shown' | 'on-request';
  /**
   * Icons that only decorate (Home's widget titles, the menu's groups and
   * pages, search results). Icons that are the control or carry a state
   * always show.
   */
  decorativeIcons: 'shown' | 'hidden';
  /** Text links: underlined on hover (the action colour marks them), or always. */
  linkUnderline: 'hover' | 'always';
  /**
   * How a state shows beside its word: a 'dot', or a 'symbol', where warning
   * and destructive states carry a "!" (for a theme whose states share a colour).
   */
  stateMarks: 'dot' | 'symbol';
  /** The top bar's current page: a filled pill, or an underline. */
  navCurrent: 'fill' | 'underline';
}

/** The chart series, chart-1 to chart-6. */
export const CHART_SERIES = [1, 2, 3, 4, 5, 6] as const;
export type ChartSeries = (typeof CHART_SERIES)[number];

export interface ChartTokens {
  /**
   * Each series' line: 'none' (solid) or a stroke-dasharray such as '5 3'.
   * Drawn where two or more series share a chart, so lines can be told apart
   * by more than colour.
   */
  dash: Readonly<Record<ChartSeries, string>>;
}

export interface Theme {
  id: string;
  name: string;
  /** One line for the Themes page: what it looks like. */
  description?: string;
  /** Kept out of the theme picker (still selectable in development). */
  hidden?: boolean;
  /** At least one; a theme with only one of them uses it for both. */
  schemes: { light: Scheme; dark?: Scheme } | { light?: Scheme; dark: Scheme };
  type: TypeTokens;
  shape: ShapeTokens;
  density: DensityTokens;
  motion: MotionTokens;
  layout: LayoutTokens;
  dashboard: DashboardLayout;
  presentation: PresentationTokens;
  chart: ChartTokens;
  /** The text contrast it holds to: WCAG 2.2 AA (4.5:1, the default) or AAA (7:1). */
  contrast?: 'AA' | 'AAA';
}
