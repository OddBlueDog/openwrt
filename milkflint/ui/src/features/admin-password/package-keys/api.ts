// Package keys on Router access: the files in /etc/apk/keys, listed, read,
// added and removed through rpcd's file object as LuCI's Repository Public
// Keys page does. The feature's ACL allows that directory.
import { z } from 'zod';
import { readText, writeText } from '@/lib/api/files';
import { call, exec } from '@/lib/ubus';
import { KEY_DIR, type RepoKey } from './model';

const listing = z.object({ entries: z.array(z.object({ name: z.string(), type: z.string() }).loose()) });

export async function listRepoKeys(): Promise<RepoKey[]> {
  const { entries } = await call('file', 'list', { path: KEY_DIR }, listing);
  const names = entries
    .filter((e) => e.type === 'file')
    .map((e) => e.name)
    .sort();
  return Promise.all(names.map(async (name) => ({ name, text: await readText(`${KEY_DIR}/${name}`) })));
}

/** A new file: refused if one of that name appeared meanwhile. Readable by all, as the firmware's own keys are. */
export function addRepoKey(name: string, text: string): Promise<void> {
  return writeText(`${KEY_DIR}/${name}`, text, '', 0o644);
}

export function removeRepoKey(name: string): Promise<void> {
  return exec('file', 'remove', { path: `${KEY_DIR}/${name}` });
}

/** A key from a link, fetched by the browser (as LuCI's page does): the site has to allow that. */
export async function fetchRepoKey(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('Couldn’t fetch it from this browser: the site may not allow that. Download the file, then drop it here.');
  }
  if (!res.ok) throw new Error(`The site answered ${String(res.status)} ${res.statusText}.`);
  return res.text();
}
