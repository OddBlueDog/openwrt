// What the Send through a VPN page reads and writes (see ARCHITECTURE.md).
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { renewInterface, type WgStatus } from '@/lib/api/wireguard';
import { type LiveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { wgStatusQuery } from '../remote-access/queries';
import { loadClient } from './api';
import type { ClientData } from './model';
import { CLIENT } from './sections';

export const vpnClientQueries = {
  settings: (): RouterQuery<ClientData> => settingsQuery(['vpn-client', 'settings'], loadClient),
  /** every WireGuard interface that's up, every 5 s (shared with Remote access) */
  status: (): LiveQuery<WgStatus> => wgStatusQuery(),
};

/** Bring the tunnel up again with its new server, keys or port (a failed renew is left to the next save), then read it all again. */
export function useRenewTunnel(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => renewInterface(CLIENT).catch(() => undefined),
    onSettled: () => client.invalidateQueries(),
  });
}
