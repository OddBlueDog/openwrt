// What the UPnP page reads and writes (see ARCHITECTURE.md).
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import type { UpnpForm } from './model';
import { clearMappings, getMappings, loadUpnp, type Mapping } from './api';

export const upnpQueries = {
  settings: (): RouterQuery<UpnpForm | null> => settingsQuery(['upnp', 'settings'], loadUpnp),
  mappings: (): LiveQuery<Mapping[]> => liveQuery(['upnp', 'mappings'], getMappings, 5000),
};

/** Close every port devices opened; the list asks again at once. */
export function useClearUpnpMappings(): UseMutationResult<void, Error, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearMappings,
    onSettled: () => client.invalidateQueries({ queryKey: upnpQueries.mappings().queryKey }),
  });
}
