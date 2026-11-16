// Components take every colour, size and font size from the theme (src/theme),
// so a new theme changes all of them. This scans the source for values that
// would slip past a theme: colour literals, Tailwind palette or arbitrary
// colour classes, dark: variants (the theme's dark scheme does that job) and
// font sizes in pixels, and the tinted icon tiles cards used to wear.
//
// Pages written before the theme system still have some: their counts are in
// design-tokens.baseline.json, and the count may only go down. A file that
// gains one fails; a file that loses one fails until the baseline is updated
// (UPDATE_TOKEN_BASELINE=1 pnpm test rewrites it), so the ratchet holds.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { splitHint } from '@/lib/hint';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = join(root, 'src');
const baselineFile = join(root, 'tests', 'design-tokens.baseline.json');

const RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'hex colour', pattern: /(?<![\w&/#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi },
  { name: 'colour function', pattern: /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/g },
  {
    name: 'Tailwind palette class',
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
  { name: 'arbitrary colour class', pattern: /-\[(?:#|rgb|hsl|oklch|color:)/g },
  { name: 'dark: variant', pattern: /(?<![\w-])dark:(?=[a-z[!-])/g },
  { name: 'font size in px', pattern: /\btext-\[\d[\d.]*(?:px|rem)\]/g },
  // the tinted icon tile beside a card's title, a template habit the redesign drops
  { name: 'icon tile', pattern: /\bsize-(?:8|9|10|11)\b[^"']*\bbg-primary\/1\d text-primary\b/g },
  // a text link takes the theme's link style (underlined always or on hover, as the theme says)
  { name: 'link without the link style', pattern: /(?<![\w-])text-primary(?![\w-])(?=[^"'`]*\bhover:underline\b)/g },
  // a component asking which theme is on instead of reading the theme's settings
  { name: 'theme id check', pattern: /['"]minimamilk['"]/g },
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'theme' || e.name === 'dev' ? [] : files(path);
    return /\.(tsx?|css)$/.test(e.name) && e.name !== 'styles.css' ? [path] : [];
  });
}

function scan(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of files(src)) {
    const text = readFileSync(path, 'utf8');
    let n = 0;
    for (const { pattern } of RULES) n += [...text.matchAll(pattern)].length;
    if (n > 0) counts[relative(root, path)] = n;
  }
  return counts;
}

test('design tokens: no file takes a colour, a palette class or a pixel font size around the theme', () => {
  const actual = scan();
  if (process.env['UPDATE_TOKEN_BASELINE'] === '1') {
    writeFileSync(baselineFile, `${JSON.stringify(actual, Object.keys(actual).sort(), 2)}\n`);
    return;
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Record<string, number>;
  const problems: string[] = [];
  for (const [file, n] of Object.entries(actual)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) {
      const hits = RULES.flatMap(({ name, pattern }) =>
        [...readFileSync(join(root, file), 'utf8').matchAll(pattern)].map((m) => `${name} "${m[0]}"`),
      );
      problems.push(`${file}: ${n} hard-coded values, ${allowed} allowed (${hits.join(', ')})`);
    }
    if (n < allowed) problems.push(`${file}: down to ${n} from ${allowed}; rerun with UPDATE_TOKEN_BASELINE=1`);
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    if (actual[file] === undefined && allowed > 0) problems.push(`${file}: now clean; rerun with UPDATE_TOKEN_BASELINE=1`);
  }
  assert.deepEqual(problems, []);
});

test('hints: the first sentence shows, the rest goes behind "Why?"', () => {
  assert.deepEqual(splitHint('Only if your provider asks for one, e.g. 911 or 101. Leave it empty otherwise.'), {
    lead: 'Only if your provider asks for one, e.g. 911 or 101.',
    rest: 'Leave it empty otherwise.',
  });
  assert.deepEqual(splitHint('Most fibre and cable connections use Automatic.'), {
    lead: 'Most fibre and cable connections use Automatic.',
    rest: undefined,
  });
  // a short tail isn't worth a click
  assert.deepEqual(splitHint('Restarts the band. Mostly.'), { lead: 'Restarts the band. Mostly.', rest: undefined });
  assert.equal(
    splitHint(
      'Off (recommended): the router starts with factory settings, and you set it up again. Settings kept from another firmware or version may not suit this one.',
    ).lead,
    'Off (recommended): the router starts with factory settings, and you set it up again.',
  );
});

// The text a prop or call takes, from just after `start` to its matching close:
// a quoted string, or a {…} / (…) expression with its nesting counted.
function argumentAt(text: string, start: number): string {
  const open = text[start];
  if (open === '"' || open === "'") {
    const end = text.indexOf(open, start + 1);
    return text.slice(start, end + 1);
  }
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

// explain()'s first argument (the explanation; the rest are UCI options and
// the "Why?" panel): to the first comma at its own level, past strings and
// template literals.
function firstArgument(text: string, open: number): string {
  const stack: string[] = [];
  let quote: string | undefined;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote !== undefined) {
      if (c === '\\') i++;
      else if (quote === '`' && c === '$' && text[i + 1] === '{') {
        stack.push('${');
        quote = undefined;
        i++;
      } else if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() === '${') quote = '`';
      else if (stack.length === 0) return text.slice(open + 1, i);
    } else if (c === ',' && stack.length === 1) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

// Explanations hide behind a "?" in a theme that asks; state must not hide with them.
const STATE_IN_EXPLANATION = /text-warning|text-destructive|<a[\s>]|<Button\b|<WidgetLink\b|onClick/;
// The components whose description or hint hides (explain() always feeds a Field)
const HIDING = new Set(['Field', 'PageHeader', 'CardHeading', 'Widget']);

test('explanations: state, warnings and actions go in status, not in a hideable description or hint', () => {
  const problems: string[] = [];
  for (const path of files(src).filter((p) => p.endsWith('.tsx'))) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\b(?:description|hint)=(?=["'{])|\bexplain\(/g)) {
      const at = m.index + m[0].length;
      if (!m[0].startsWith('explain')) {
        // the element the prop is on: the last tag opened before it
        const tag = [...text.slice(0, m.index).matchAll(/<([A-Z][A-Za-z]*)\b/g)].at(-1)?.[1];
        if (tag === undefined || !HIDING.has(tag)) continue;
      }
      const arg = m[0].startsWith('explain') ? firstArgument(text, at - 1) : argumentAt(text, at);
      if (STATE_IN_EXPLANATION.test(arg)) {
        const line = text.slice(0, m.index).split('\n').length;
        problems.push(`${relative(root, path)}:${String(line)} ${m[0]}…`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

// A hint that switches to why a control can't be used, or to an error, is
// state in plain words: it must be status too (a conditional explanation
// with one of these is the tell).
const STATE_WORDS = /can[’']t\b|won[’']t\b|\bNeeds\b|isn[’']t\b|\bNot as\b|\bno [a-z ]{1,30}fast path\b|left as it is|_MISSING\b/;

test('explanations: a hint that turns into a reason or an error goes in status', () => {
  const problems: string[] = [];
  for (const path of files(src).filter((p) => p.endsWith('.tsx'))) {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/\b(?:description|hint)=(?=\{)|\bexplain\(/g)) {
      const at = m.index + m[0].length;
      if (!m[0].startsWith('explain')) {
        const tag = [...text.slice(0, m.index).matchAll(/<([A-Z][A-Za-z]*)\b/g)].at(-1)?.[1];
        if (tag === undefined || !HIDING.has(tag)) continue;
      }
      const arg = m[0].startsWith('explain') ? firstArgument(text, at - 1) : argumentAt(text, at);
      // a branch's own words near its start: "Needs …", "Channel 52 can’t be …"
      const strings = arg.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
      if (/\s\?\s/.test(arg) && strings.some((t) => STATE_WORDS.test(t.slice(0, 70)))) {
        const line = text.slice(0, m.index).split('\n').length;
        problems.push(`${relative(root, path)}:${String(line)} ${m[0]}…`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('link: the hover underline only where there is hover, as Tailwind’s hover: does (no underline stuck after a tap)', () => {
  const css = readFileSync(join(src, 'styles.css'), 'utf8');
  const link = /@utility link \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(link, /@media \(hover: hover\) \{\s*&:hover \{/);
});
