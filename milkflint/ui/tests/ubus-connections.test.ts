// The router's ucode scripts close every ubus connection they open. A
// connection only dropped stays open until garbage collection, which a
// standalone ucode script never runs: a loop that drops one each time holds
// more and more sockets in ubusd until it runs out of files and refuses
// every client (LuCI, the login, procd's services). adguardhome-monitor did
// this every 30 s. rpcd collects after each call today, but a later ucode
// keeps connections across collections, so plugins close theirs too.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/', import.meta.url));

// one connection for the life of a short or single-run script, closed when it exits
const HELD = new Set(['features/test-bench/cgi', 'features/test-bench/bin/bench-runner', 'features/test-bench/bin/bench-dns']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const scripts = walk(root)
  .map((path) => ({ file: relative(root, path), text: readFileSync(path, 'utf8') }))
  .filter(({ text }) => /from 'ubus'|require\('ubus'\)/.test(text));

test('the feed has ucode scripts that use ubus', () => {
  assert.ok(scripts.length >= 8, `found ${scripts.length}`);
});

test('no connection is used once and dropped', () => {
  const dropped = scripts.flatMap(({ file, text }) =>
    text
      .split('\n')
      .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
      .filter(({ line }) => /\bconnect\([^)]*\)\s*\??\./.test(line))
      .map(({ at }) => at),
  );
  assert.deepEqual(dropped, []);
});

test('every connection kept in a name is disconnected', () => {
  const open = scripts.flatMap(({ file, text }) => {
    if (HELD.has(file)) return [];
    return [...text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*connect\(/g)]
      .map((m) => m[1] ?? '')
      .filter((name) => !new RegExp(`\\b${name}\\??\\.disconnect\\(`).test(text))
      .map((name) => `${file}: ${name}`);
  });
  assert.deepEqual(open, []);
});

test('the held ones are still there (else drop them from HELD)', () => {
  for (const file of HELD)
    assert.ok(
      scripts.some((s) => s.file === file),
      file,
    );
});
