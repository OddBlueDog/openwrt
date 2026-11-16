// Writes every theme as CSS custom properties. Vite's config serves the result
// as the module virtual:milkflint-themes.css, so it's built from the theme
// files and never edited by hand.
//
// <html data-theme="standard" data-darkmode="true"> picks the theme and its
// dark scheme (data-darkmode is the attribute LuCI's themes use for theirs).
// Any element can carry both attributes to show a theme inside another, as the
// development specimen page does. The first theme also answers for :root, so a
// page with no attribute yet still has every token.
import { CHART_SERIES, COLOR_TOKENS, ELEVATION_TOKENS, RADII, type Scheme, TEXT_SIZES, type Theme } from './contract.ts';

/** The custom property each token is written to. */
export const cssVar = {
  color: (token: string): string => `--${token}`,
  elevation: (token: string): string => `--mf-${token}`,
  text: (size: string): string => `--mf-text-${size}`,
  leading: (size: string): string => `--mf-text-${size}-leading`,
  radius: (r: string): string => `--mf-radius-${r}`,
  dash: (n: number): string => `--mf-chart-${String(n)}-dash`,
} as const;

function declarations(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([name, value]) => `  ${name}: ${value};`).join('\n');
}

function schemeEntries(scheme: Scheme): [string, string][] {
  return [
    ...COLOR_TOKENS.map((t): [string, string] => [cssVar.color(t), scheme.color[t]]),
    ...ELEVATION_TOKENS.map((t): [string, string] => [cssVar.elevation(t), scheme.elevation[t]]),
  ];
}

function themeEntries(theme: Theme): [string, string][] {
  return [
    ['--font-sans', theme.type.sans],
    ['--font-mono', theme.type.mono],
    ...TEXT_SIZES.flatMap((s): [string, string][] => [
      [cssVar.text(s), theme.type.scale[s].size],
      [cssVar.leading(s), theme.type.scale[s].leading],
    ]),
    ...RADII.map((r): [string, string] => [cssVar.radius(r), theme.shape.radius[r]]),
    ['--mf-space', theme.density.space],
    ['--mf-duration-fast', theme.motion.fast],
    ['--mf-duration-base', theme.motion.base],
    ['--mf-duration-slow', theme.motion.slow],
    ['--mf-ease-standard', theme.motion.standard],
    ['--mf-ease-enter', theme.motion.enter],
    ['--mf-nav-width', theme.layout.navWidth],
    ['--mf-content-max', theme.layout.contentMax],
    ['--mf-gutter', theme.layout.gutter],
    ...CHART_SERIES.map((n): [string, string] => [cssVar.dash(n), theme.chart.dash[n]]),
    ['--mf-link-underline', theme.presentation.linkUnderline === 'always' ? 'underline' : 'none'],
  ];
}

/** The theme's light and dark schemes, a single-scheme theme using its one for both. */
export function schemesOf(theme: Theme): { light: Scheme; dark: Scheme } {
  const { light, dark } = theme.schemes;
  const first = light ?? dark;
  if (first === undefined) throw new Error(`theme ${theme.id} has no scheme`);
  return { light: light ?? first, dark: dark ?? first };
}

/**
 * `root: false` (custom themes, written in the browser beside the built-in
 * ones): no :root block and no reduced-motion rule, which the built-in CSS has.
 */
export function themeCss(themes: readonly Theme[], { root = true }: { root?: boolean } = {}): string {
  const blocks: string[] = [
    root
      ? '/* Generated from src/theme/themes by src/theme/css.ts: edit those, not this. */'
      : '/* Custom themes, from the Themes page (src/theme/custom.ts). */',
  ];
  const more: string[] = [];
  themes.forEach((theme, i) => {
    const first = root && i === 0;
    const base = first ? `:root,\n[data-theme='${theme.id}']` : `[data-theme='${theme.id}']`;
    const darkSel = first
      ? `:root[data-darkmode='true'],\n[data-theme='${theme.id}'][data-darkmode='true']`
      : `[data-theme='${theme.id}'][data-darkmode='true']`;
    const { light, dark } = schemesOf(theme);
    const lightIsDark = theme.schemes.light === undefined;
    blocks.push(
      `${base} {\n${declarations([...themeEntries(theme), ...schemeEntries(light)])}\n  color-scheme: ${lightIsDark ? 'dark' : 'light'};\n}`,
      `${darkSel} {\n${declarations(schemeEntries(dark))}\n  color-scheme: dark;\n}`,
    );
    const overrides = (scheme: Scheme): [string, string][] =>
      Object.entries(scheme.more ?? {}).map(([t, v]): [string, string] => [cssVar.color(t), v]);
    if (overrides(light).length > 0)
      more.push(`  ${base.replaceAll('\n', '\n  ')} {\n  ${declarations(overrides(light)).replaceAll('\n', '\n  ')}\n  }`);
    if (overrides(dark).length > 0)
      more.push(`  ${darkSel.replaceAll('\n', '\n  ')} {\n  ${declarations(overrides(dark)).replaceAll('\n', '\n  ')}\n  }`);
  });
  if (more.length > 0) blocks.push(`@media (prefers-contrast: more) {\n${more.join('\n')}\n}`);
  if (!root) return `${blocks.join('\n\n')}\n`;
  blocks.push(
    `@media (prefers-reduced-motion: reduce) {\n  :root,\n  [data-theme] {\n    --mf-duration-fast: 0ms;\n    --mf-duration-base: 0ms;\n    --mf-duration-slow: 0ms;\n  }\n}`,
  );
  return `${blocks.join('\n\n')}\n`;
}
