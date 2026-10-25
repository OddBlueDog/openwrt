// pnpm package: copy the built app (dist/) into the OpenWrt package, where
// the router image build picks it up: package/milkflint/milkflint-ui/htdocs/.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const htdocs = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/htdocs/', import.meta.url));

await mkdir(htdocs, { recursive: true });
for (const entry of await readdir(htdocs)) {
  if (entry !== '.keep') await rm(`${htdocs}${entry}`, { recursive: true, force: true });
}
await cp(dist, htdocs, { recursive: true });
console.log(`Copied ui/dist/ to package/milkflint/milkflint-ui/htdocs/ (${String((await readdir(htdocs)).length)} entries).`);
