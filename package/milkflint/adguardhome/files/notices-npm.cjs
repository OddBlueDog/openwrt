// SPDX-License-Identifier: MIT
// MilkFlint: the licenses of the npm packages AdGuard Home's web interface is
// built from, for its THIRD-PARTY-NOTICES.txt. Reads <client>/package-lock.json
// (lockfile v2/v3): every package not marked "dev" (devOptional ones are
// development tools too) is in the production dependency tree, so webpack may
// bundle it. For each: name, version, the license package.json declares, and
// the text of its LICENSE / LICENCE / COPYING / NOTICE files.
// Usage: node notices-npm.cjs <client dir>  (writes to stdout)
'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
const FILES = /^(licen[cs]e|copying|notice)([._-].*)?$/i;

const out = [];
let count = 0;
for (const [where, pkg] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
  if (where === '' || pkg.dev === true || pkg.devOptional === true || pkg.link === true) continue;
  const at = path.join(dir, where);
  if (!fs.existsSync(at)) continue; // an optional package for another platform
  const name = pkg.name ?? where.replace(/^.*node_modules\//, '');
  let declared = pkg.license;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(at, 'package.json'), 'utf8'));
    declared = declared ?? meta.license ?? (Array.isArray(meta.licenses) ? meta.licenses.map((l) => l.type ?? l).join(' OR ') : undefined);
  } catch {
    // no package.json: keep what the lockfile says
  }
  out.push(`--- ${name} ${pkg.version ?? ''} (${declared ?? 'license not declared'})`);
  const texts = fs
    .readdirSync(at)
    .filter((f) => FILES.test(f) && fs.statSync(path.join(at, f)).isFile())
    .sort();
  if (texts.length === 0) out.push('(no license file in the package; see its declared license above)');
  for (const f of texts) out.push(fs.readFileSync(path.join(at, f), 'utf8').trimEnd());
  out.push('');
  count++;
}
process.stdout.write(`${String(count)} packages\n\n${out.join('\n')}\n`);
