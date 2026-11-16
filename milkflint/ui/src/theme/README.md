# Themes

Everything the interface draws with comes from a theme: colours, the type
face and scale, corner radii, spacing (density), shadows, motion, and where
things sit (the menu at the side or along the top, Home's widgets). A theme is
one TypeScript file of data; components never hold a colour or a size of
their own.

## How it fits together

- `contract.ts` lists every token a theme must define, and nothing else. The
  colour names follow shadcn/ui's (`background`, `card`, `primary`,
  `muted-foreground`…) plus MilkFlint's own (status surfaces, the side rail,
  charts, the logo).
- `primitives.ts` holds the raw values (OKLCH ramps, font lists) that themes
  are made from. Components never use these.
- `themes/*.ts` are the themes. `themes/index.ts` lists them; the first is the
  default.
- `css.ts` writes every theme as CSS custom properties. Vite serves the result
  as `virtual:milkflint-themes.css`. The attributes `data-theme` and
  `data-darkmode` on `<html>` pick the theme and its scheme (data-darkmode is
  LuCI's attribute). `src/styles.css` maps the properties onto Tailwind's
  names and switches Tailwind's own palette and scales off, so only the
  theme's values exist.
- `dtcg.ts` exports a theme in the W3C Design Tokens format, for design tools.
- `src/lib/theme.ts` is the runtime: the router's theme and custom themes,
  with a copy in the browser so the first paint is right, and each device's
  light or dark.

## Adding a theme

1. Copy `themes/plain-milk.ts` to `themes/<name>.ts` (or spread a theme, as
   `honey-milk.ts` spreads Plain milk and changes its colours), give it an
   `id`, a `name` and a one-line `description`, and change what you like.
   TypeScript refuses a theme that misses a token or adds one the contract
   doesn't know.
2. Add it to `themes/index.ts`: it becomes a card on System → Themes. Set
   `hidden: true` to keep it off while you work on it (development builds
   still show it). `DEFAULT_THEME_ID` there names the default (Honey milk).
3. For chart colours, run `node scripts/theme-series.ts` with the scheme's
   panel colour and a lightness range, once per scheme, and paste the result
   (the script's header shows an example).
4. Run `pnpm test`. `tests/theme.test.ts` checks every token in both schemes
   and with `prefers-contrast: more`: WCAG 2.2 AA contrast for text (4.5:1)
   and for controls, focus rings and chart marks (3:1), chart colours that
   stay apart for the three common colour-vision deficiencies, a type scale
   that never goes under 12 px, and Home's layout.
5. Look at it: `pnpm dev`, then `#/specimen` shows every token and component,
   with every theme in both schemes side by side.

A theme may define only a light or only a dark scheme; it's then used for
both. `more` holds overrides for `prefers-contrast: more`. Durations drop to
zero under `prefers-reduced-motion` whatever the theme says.

Beyond its looks, a theme says (`defaults.ts` holds the values that change
nothing):

- `presentation`: explanations `shown` or `on-request` (behind a "?"),
  decorative icons, links underlined on hover or always, states marked by a
  dot or a "!", the top bar's current page as a pill or an underline. The
  shared components read it through `src/lib/presentation.ts`.
- `chart.dash`: each series' line, so lines drawn together can be told apart
  by more than colour (`components/charts/series.ts`).
- `layout.tools`: the top bar's tools on their own row or compact.
- `dashboard.reduced`: Home places a chosen few widgets (the glance widgets)
  rather than every one.
- `contrast: 'AAA'`: its text is held to 7:1.

## Custom themes

System → Themes customises any theme into one of your own: a built-in base
and the colours changed, `#rrggbb` per scheme (`custom.ts`), kept on the
router with the theme in use (`src/lib/api/themes.ts`, the `milkflint.themes`
rpcd object). `css.ts` writes them in the browser (`themeCss(…, { root:
false })`), and the editor checks them against the same contrast pairs as the
tests (`checks.ts`). The theme in use is the router's, for every device; light
or dark is each device's own.

## Rules for components

`tests/design-tokens.test.ts` scans the source and fails on a colour literal,
a Tailwind palette or arbitrary colour class, a `dark:` variant, a font size
in pixels, a tinted icon tile, a link styled by hand (use `link`), or a check
for a theme by its id (read its settings instead). Pages from before the theme
system have a baseline that may only go down.

A description or hint is an explanation and may hide behind a "?". Live
state, a warning, why a control can't be changed, or a link to another page
goes in the component's `status`, which always shows; the same test fails on
a warning, link or button inside an explanation that can hide.
