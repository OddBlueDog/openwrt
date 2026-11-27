// What the Startup page reads and writes (see ARCHITECTURE.md).
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { getServices, type InitAction, readRcLocal, runInit, saveRcLocal } from './api';
import type { Service } from './model';

export const startupQueries = {
  services: (): RouterQuery<Service[]> => settingsQuery(['startup', 'services'], getServices),
  rcLocal: (): RouterQuery<string> => settingsQuery(['startup', 'rc-local'], readRcLocal),
};

/** /etc/init.d/<name> <action>; procd acts in the background, so the list is read again a second later. */
export function useRunInit(): UseMutationResult<void, Error, { name: string; action: InitAction }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }) => runInit(name, action),
    onSettled: () => {
      window.setTimeout(() => {
        void client.invalidateQueries({ queryKey: startupQueries.services().queryKey });
      }, 1000);
    },
  });
}

/** Write /etc/rc.local (`before` is what was read, for the file's own check). */
export function useSaveRcLocal(): UseMutationResult<void, Error, { text: string; before: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ text, before }) => saveRcLocal(text, before),
    onSuccess: () => client.invalidateQueries({ queryKey: startupQueries.rcLocal().queryKey }),
  });
}
