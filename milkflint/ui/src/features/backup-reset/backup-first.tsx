// "Download a backup first", for the confirmations of what erases settings:
// an upgrade that doesn't keep them, and a factory reset.
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { cn, errorMessage } from '@/lib/utils';
import { useSaveBackup } from './queries';

export function BackupFirst(): ReactElement {
  const save = useSaveBackup();
  const state: 'idle' | 'busy' | 'done' | { error: string } = save.isPending
    ? 'busy'
    : save.isSuccess
      ? 'done'
      : save.error !== null
        ? { error: errorMessage(save.error) }
        : 'idle';
  const run = (): void => {
    save.mutate();
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="outline" size="sm" onClick={run} disabled={state === 'busy'}>
        {state === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
        Download a backup first
      </Button>
      <span role="status" className={cn('text-xs', typeof state === 'object' ? 'text-destructive' : 'text-muted-foreground')}>
        {state === 'done' ? 'Saved to your downloads.' : typeof state === 'object' ? `Backup failed: ${state.error}` : ''}
      </span>
    </div>
  );
}
