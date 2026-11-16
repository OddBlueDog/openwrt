// Primitives: the raw values themes are made from. Components never use these
// directly; a theme maps them onto the semantic roles in contract.ts.
// Colours are OKLCH, so a ramp's steps are even to the eye.

export const ramp = <T extends Readonly<Record<number, readonly [number, number]>>>(
  hue: number,
  steps: T,
): { readonly [K in keyof T]: string } =>
  Object.fromEntries(Object.entries<readonly [number, number]>(steps).map(([k, [l, c]]) => [k, `oklch(${l}% ${c} ${hue})`])) as {
    readonly [K in keyof T]: string;
  };

/** A cool grey with a trace of blue: surfaces, text and lines. */
export const slate = ramp(258, {
  0: [100, 0],
  25: [98.9, 0.002],
  50: [97.3, 0.004],
  100: [95.3, 0.006],
  150: [92.9, 0.008],
  200: [89.8, 0.01],
  300: [83.2, 0.013],
  400: [70.5, 0.017],
  450: [64.5, 0.018],
  500: [57.5, 0.02],
  600: [48.5, 0.021],
  700: [39.5, 0.021],
  750: [33.5, 0.02],
  800: [28.8, 0.018],
  850: [24.6, 0.016],
  900: [21, 0.015],
  925: [18.6, 0.013],
  950: [16.2, 0.011],
  975: [13.6, 0.009],
} as const);

/** The action colour. */
export const blue = ramp(262, {
  50: [96.6, 0.02],
  100: [93.2, 0.04],
  200: [87, 0.075],
  300: [78, 0.12],
  400: [68.5, 0.16],
  500: [58.5, 0.2],
  600: [51.5, 0.205],
  700: [45.5, 0.19],
  800: [38, 0.155],
  900: [30, 0.11],
  950: [24, 0.08],
} as const);

export const green = ramp(150, {
  50: [96.8, 0.03],
  100: [93.5, 0.055],
  500: [62, 0.15],
  600: [51, 0.13],
  700: [44, 0.11],
  300: [80, 0.15],
  400: [74, 0.16],
  900: [27, 0.06],
  950: [22, 0.045],
} as const);

export const amber = ramp(70, {
  50: [97.2, 0.03],
  100: [94, 0.06],
  300: [84, 0.14],
  400: [79, 0.155],
  500: [70, 0.16],
  600: [55, 0.125],
  700: [48, 0.105],
  900: [28, 0.055],
  950: [23, 0.04],
} as const);

export const red = ramp(27, {
  50: [96.5, 0.018],
  100: [93, 0.035],
  300: [80, 0.1],
  400: [71, 0.15],
  500: [60, 0.2],
  600: [52, 0.19],
  700: [45, 0.16],
  900: [27, 0.07],
  950: [22, 0.055],
} as const);

export const sky = ramp(240, {
  50: [96.8, 0.018],
  100: [93.5, 0.035],
  400: [74, 0.12],
  600: [51, 0.14],
  900: [27, 0.06],
  950: [22, 0.045],
} as const);

/** Warm paper greys (Honey milk): MilkFlint's original surfaces, text and lines. */
export const paper = ramp(95, {
  0: [98.5, 0.005],
  50: [96.7, 0.007],
  75: [94.6, 0.01],
  100: [93.3, 0.011],
  150: [91.5, 0.014],
  200: [87.6, 0.014],
  300: [82.3, 0.018],
  400: [70, 0.02],
  500: [55.5, 0.02],
  600: [46.7, 0.013],
  700: [38, 0.012],
  750: [33, 0.011],
  800: [31.7, 0.009],
  850: [28.1, 0.007],
  875: [24.8, 0.006],
  900: [23.5, 0.006],
  925: [21.7, 0.006],
  940: [20.4, 0.004],
  950: [19, 0.004],
  975: [15, 0.004],
} as const);

/** Rust (Honey milk's action colour): MilkFlint's original accent. */
export const rust = ramp(40, {
  50: [96.5, 0.02],
  100: [92.5, 0.04],
  200: [86, 0.07],
  300: [78, 0.11],
  400: [73.4, 0.138],
  500: [62, 0.16],
  600: [53.2, 0.16],
  700: [47, 0.15],
  800: [40, 0.125],
  900: [31, 0.09],
  950: [26, 0.065],
} as const);

/**
 * Chart series, found by search (scratch script, kept in the commit message):
 * every pair stays apart for typical vision, protanopia, deuteranopia and
 * tritanopia, each is inside sRGB, and each reaches 3:1 on its panel.
 * Blue and orange (chart-1 and chart-2) are upload and download on traffic
 * charts, the pair kept furthest apart.
 */
export const series = {
  blue: { light: 'oklch(65.5% 0.18 252)', dark: 'oklch(62% 0.195 267)' },
  orange: { light: 'oklch(50.5% 0.135 49)', dark: 'oklch(73.5% 0.12 62)' },
  teal: { light: 'oklch(51.5% 0.085 204)', dark: 'oklch(87.5% 0.14 175)' },
  purple: { light: 'oklch(41.5% 0.19 293)', dark: 'oklch(76% 0.1 288)' },
  olive: { light: 'oklch(65.5% 0.135 103)', dark: 'oklch(88% 0.18 99)' },
  wine: { light: 'oklch(36.5% 0.1 7)', dark: 'oklch(62% 0.195 359)' },
} as const;

/**
 * Honey milk's chart series, found the same way (scripts/theme-series.ts) on
 * its warm panels: oklch(98.5% 0.005 95) light, oklch(21.7% 0.006 100) dark.
 */
export const honeySeries = {
  blue: { light: 'oklch(36% 0.18 263)', dark: 'oklch(75% 0.12 255)' },
  orange: { light: 'oklch(50% 0.165 37)', dark: 'oklch(63.5% 0.2 36)' },
  teal: { light: 'oklch(63.5% 0.1 195)', dark: 'oklch(87% 0.15 180)' },
  purple: { light: 'oklch(55% 0.2 294)', dark: 'oklch(62% 0.2 289)' },
  olive: { light: 'oklch(65% 0.13 91)', dark: 'oklch(87.5% 0.185 106)' },
  wine: { light: 'oklch(36.5% 0.13 4)', dark: 'oklch(62% 0.115 341)' },
} as const;

/** The logo as drawn (docs/logo.svg). */
export const logo = { stone: '#2e333b', stoneOnDark: '#4b525d', milk: '#fbf7ee' } as const;

/** Font lists. The system ones cost the router nothing to serve. */
export const fonts = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  systemRounded:
    "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** Achromatic greys by lightness (Minimamilk): mono[45] is oklch(45% 0 0). */
export const mono = ramp(0, {
  14: [14, 0],
  18: [18, 0],
  19: [19, 0],
  21: [21, 0],
  22: [22, 0],
  24: [24, 0],
  26: [26, 0],
  27: [27, 0],
  30: [30, 0],
  32: [32, 0],
  35: [35, 0],
  36: [36, 0],
  40: [40, 0],
  42: [42, 0],
  45: [45, 0],
  50: [50, 0],
  53: [53, 0],
  54: [54, 0],
  55: [55, 0],
  60: [60, 0],
  62: [62, 0],
  63: [63, 0],
  65: [65, 0],
  70: [70, 0],
  71: [71, 0],
  75: [75, 0],
  78: [78, 0],
  80: [80, 0],
  82: [82, 0],
  86: [86, 0],
  89: [89, 0],
  90: [90, 0],
  91: [91, 0],
  92: [92, 0],
  93: [93, 0],
  95: [95, 0],
  95.5: [95.5, 0],
  96.5: [96.5, 0],
  97: [97, 0],
  100: [100, 0],
} as const);
