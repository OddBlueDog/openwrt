// What Backup & reset does (see ARCHITECTURE.md): a backup download, and the
// restart or factory reset after which the page waits for the router and
// reloads.
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { reboot } from '@/lib/api/system';
import { factoryReset, saveBackup, waitForRouterAndReload } from './api';

/** Save the settings to a file in the browser's downloads. */
export function useSaveBackup(): UseMutationResult<void, Error, void> {
  return useMutation({ mutationFn: saveBackup });
}

/** Restart the router, or erase everything; then wait for it to come back and reload the page. */
export function useRestart(): UseMutationResult<never, Error, 'restart' | 'reset'> {
  return useMutation({
    mutationFn: async (what: 'restart' | 'reset') => {
      try {
        await (what === 'restart' ? reboot() : factoryReset());
      } catch {
        // the router may drop the connection while answering
      }
      return waitForRouterAndReload();
    },
  });
}
