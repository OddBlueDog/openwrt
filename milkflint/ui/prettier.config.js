// Prettier formats this app's code (`pnpm format`; `pnpm check` runs
// `pnpm format:check` and fails on anything unformatted). It matches the
// style the code was written in: single quotes, semicolons, trailing commas,
// and a 130-column line, wide enough for Tailwind's class lists.
// prettier-plugin-tailwindcss sorts those classes into Tailwind's own order,
// in className and inside cn() and cva(), reading the theme's names from the
// app's stylesheet.

/** @type {import('prettier').Config} */
export default {
  printWidth: 130,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './src/styles.css',
  tailwindFunctions: ['cn', 'cva'],
};
