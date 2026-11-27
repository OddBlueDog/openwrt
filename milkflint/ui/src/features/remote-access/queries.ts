// What the Remote access page reads and writes (see ARCHITECTURE.md). The
// WireGuard status read is the VPN pages' both: one key, one call.
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { getWgStatus, type Keys, newKeys, renewInterface, type WgStatus } from '@/lib/api/wireguard';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { loadServer } from './api';
import type { ServerData } from './model';
import { SERVER } from './sections';

/** Every WireGuard interface that's up and its peers, every 5 s (Remote access and Send through a VPN). */
/** WireGuard's tunnels, as Remote access, the VPN and Home read them: every 5 s, or at the reader's own pace. */
export const wgStatusQuery = (every = 5000): LiveQuery<WgStatus> => liveQuery(['wireguard', 'status'], getWgStatus, every);

export const remoteAccessQueries = {
  settings: (): RouterQuery<ServerData> => settingsQuery(['remote-access', 'settings'], loadServer),
  status: (): LiveQuery<WgStatus> => wgStatusQuery(),
};

/** A new key pair and preshared key, made on the router. */
export function useNewKeys(): UseMutationResult<Keys, Error, void> {
  return useMutation({ mutationFn: newKeys });
}

/** Bring the server's interface up again with its devices as saved (a failed renew is left to the next save). */
export function useRenewServer(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => renewInterface(SERVER).catch(() => undefined),
    onSettled: () => client.invalidateQueries(),
  });
}
