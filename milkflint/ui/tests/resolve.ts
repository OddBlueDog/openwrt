// Loaded before the tests (node --import, see package.json): lets them import
// any module in src/ the way Vite resolves it there, with the @/ alias
// (tsconfig.app.json's paths) and without file extensions. Node's own
// resolution needs neither, so it handles everything else. Node strips
// TypeScript's types itself but doesn't read JSX, so a .tsx module (Home's
// widget registry) is compiled here with the TypeScript the project already
// has, loaded only when a test imports one.
import { readFileSync, statSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as TS from 'typescript';

const src = new URL('../src/', import.meta.url).href;

// A file there: as named, or with .ts, .tsx or /index.ts added
function existing(url: string): string | undefined {
  for (const candidate of [url, `${url}.ts`, `${url}.tsx`, `${url}/index.ts`]) {
    if (statSync(fileURLToPath(candidate), { throwIfNoEntry: false })?.isFile() === true) return candidate;
  }
  return undefined;
}

type TypeScript = typeof TS;
const load: (id: 'typescript') => TypeScript = createRequire(import.meta.url);
let ts: TypeScript | undefined;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    let url: string | undefined;
    if (specifier.startsWith('@/')) url = new URL(specifier.slice(2), src).href;
    else if (parent?.startsWith(src) === true && specifier.startsWith('.')) url = new URL(specifier, parent).href;
    const found = url === undefined ? undefined : existing(url);
    return nextResolve(found ?? specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(src) || !url.endsWith('.tsx')) return nextLoad(url, context);
    ts ??= load('typescript');
    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
