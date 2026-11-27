// SSH on Router access: Dropbear's settings (/etc/config/dropbear, through
// UCI) and the keys that may sign in as root, read and written as LuCI's
// SSH-Keys page does. The feature's ACL allows those two.
import { readText, writeText } from '@/lib/api/files';
import { getConfig, type Section } from '@/lib/api/uci';

export const AUTHORIZED_KEYS = '/etc/dropbear/authorized_keys';

export function getSshConfig(): Promise<Section[]> {
  return getConfig('dropbear');
}

export function readAuthorizedKeys(): Promise<string> {
  return readText(AUTHORIZED_KEYS);
}

/** Dropbear's settings and the keys file's text, as the SSH and SSH keys tabs read them. */
export interface SshState {
  sections: Section[];
  keys: string;
}

export async function loadSsh(): Promise<SshState> {
  const [sections, keys] = await Promise.all([getSshConfig(), readAuthorizedKeys()]);
  return { sections, keys };
}

/** Write the keys, if the file is still what the page read; root's alone (0600), as Dropbear wants. */
export function saveAuthorizedKeys(text: string, before: string): Promise<void> {
  return writeText(AUTHORIZED_KEYS, text, before, 0o600);
}
