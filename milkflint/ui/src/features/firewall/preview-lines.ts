// A section as /etc/config/<config> will hold it, for the sheets' preview (and its copy button).
import type { Change, Section } from '@/lib/api/uci';

/** Options that hold a WireGuard key (the VPN profiles', the live tunnel's): a preview never shows them. */
const SECRET = new Set(['private_key', 'preshared_key']);
const MASK = "'••••••••'";

const quote = (v: string): string => `'${v.replaceAll("'", "'\\''")}'`;

/** The section as /etc/config/<config> will hold it once the changes are applied. */
export function previewLines(config: string, type: string, original: Section | undefined, changes: readonly Change[]): string[] {
  const merged = new Map<string, string | string[]>();
  for (const [k, v] of Object.entries(original ?? {}))
    if (!k.startsWith('.') && v !== undefined && typeof v !== 'boolean' && typeof v !== 'number') merged.set(k, v);
  // only this section's: a sheet's changes can touch others (a zone's forwardings)
  const name = original?.['.name'];
  for (const c of changes) {
    if (c.config !== config) continue;
    if (c.op === 'add' && name === undefined && c.type === type) for (const [k, v] of Object.entries(c.values)) merged.set(k, v);
    else if (c.op === 'set' && c.section === name) for (const [k, v] of Object.entries(c.values)) merged.set(k, v);
    else if (c.op === 'unset' && c.section === name) for (const k of c.options) merged.delete(k);
  }
  const lines = [`config ${type}${original === undefined ? '' : ` ${quote(original['.name'])}`}`];
  for (const [k, v] of merged) {
    if (SECRET.has(k)) lines.push(`\toption ${k} ${MASK}`);
    else if (Array.isArray(v)) for (const x of v) lines.push(`\tlist ${k} ${quote(x)}`);
    else lines.push(`\toption ${k} ${quote(v)}`);
  }
  return lines;
}
