// Loaded before the tests (node --import, see package.json): lets them import
// any module in src/ the way Vite resolves it there, with the @/ alias
// (tsconfig.app.json's paths) and without file extensions. Node's own
// resolution needs neither, so it handles everything else.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const src = new URL('../src/', import.meta.url).href;

// A file there: as named, or with .ts or /index.ts added
function existing(url: string): string | undefined {
  for (const candidate of [url, `${url}.ts`, `${url}/index.ts`]) {
    const path = fileURLToPath(candidate);
    if (existsSync(path) && !path.endsWith('/')) return candidate;
  }
  return undefined;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    let url: string | undefined;
    if (specifier.startsWith('@/')) url = new URL(specifier.slice(2), src).href;
    else if (parent?.startsWith(src) === true && specifier.startsWith('.')) url = new URL(specifier, parent).href;
    const found = url === undefined ? undefined : existing(url);
    return nextResolve(found ?? specifier, context);
  },
});
