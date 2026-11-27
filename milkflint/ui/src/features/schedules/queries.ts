// What Scheduled tasks reads and writes (see ARCHITECTURE.md): root's
// crontab, saved as a file (not through UCI), and read again once saved.
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { readCrontab, saveCrontab } from './api';

export const schedulesQueries = {
  crontab: (): RouterQuery<string> => settingsQuery(['schedules', 'crontab'], readCrontab),
};

/** Write the crontab if it's still `before`, have cron take it, and read it back before the next save may start. */
export function useSaveCrontab(): UseMutationResult<void, Error, { text: string; before: string }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ text, before }: { text: string; before: string }) => saveCrontab(text, before),
    onSuccess: () => client.invalidateQueries({ queryKey: schedulesQueries.crontab().queryKey }),
  });
}
