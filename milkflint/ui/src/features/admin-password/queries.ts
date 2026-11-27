// What Router access reads and writes, besides HTTPS (../https/queries.ts):
// SSH's settings and keys, the networks SSH can answer on, the package
// keys, and the password (see ARCHITECTURE.md).
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { getInterfaces, type NetworkInterface } from '@/lib/api/network';
import { setPassword } from '@/lib/api/system';
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { OLD_DEFAULT_PASSWORD, setAdminPassword } from '@/lib/session';
import { addRepoKey, listRepoKeys, removeRepoKey } from './package-keys/api';
import type { RepoKey } from './package-keys/model';
import { loadSsh, saveAuthorizedKeys, type SshState } from './ssh/api';

export const accessQueries = {
  /** Dropbear's settings and the keys that sign in */
  ssh: (): RouterQuery<SshState> => settingsQuery(['admin-password', 'ssh'], loadSsh),
  /** the networks an SSH server can answer on */
  interfaces: (): RouterQuery<NetworkInterface[]> => settingsQuery(['admin-password', 'interfaces'], getInterfaces),
  packageKeys: (): RouterQuery<RepoKey[]> => settingsQuery(['admin-password', 'package-keys'], listRepoKeys),
};

/**
 * Set the admin (root) password; the session then knows whether it's the old
 * default. Not kept once nothing watches it: its variable is the password.
 */
export function useSetPassword(): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: setPassword,
    gcTime: 0,
    onSuccess: (_, password) => {
      setAdminPassword(password === OLD_DEFAULT_PASSWORD ? 'old-default' : 'set');
    },
  });
}

/** Write the keys that sign in (`before`: the file as read, for its own check). */
export function useSaveAuthorizedKeys(): UseMutationResult<void, Error, { text: string; before: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ text, before }) => saveAuthorizedKeys(text, before),
    onSuccess: () => client.invalidateQueries({ queryKey: accessQueries.ssh().queryKey }),
  });
}

export function useAddRepoKey(): UseMutationResult<void, Error, { name: string; text: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, text }) => addRepoKey(name, text),
    onSuccess: () => client.invalidateQueries({ queryKey: accessQueries.packageKeys().queryKey }),
  });
}

export function useRemoveRepoKey(): UseMutationResult<void, Error, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: removeRepoKey,
    onSuccess: () => client.invalidateQueries({ queryKey: accessQueries.packageKeys().queryKey }),
  });
}
