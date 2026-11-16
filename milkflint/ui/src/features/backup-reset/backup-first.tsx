// "Download a backup first", for the confirmations of what erases settings:
// an upgrade that doesn't keep them, and a factory reset.
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn, errorMessage } from '@/lib/utils';
import { saveBackup } from './api';

export function BackupFirst(): ReactElement {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | { error: string }>('idle');
  const run = async (): Promise<void> => {
    setState('busy');
    try {
      await saveBackup();
      setState('done');
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={state === 'busy'}>
        {state === 'busy' ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
        Download a backup first
      </Button>
      <span role="status" className={cn('text-xs', typeof state === 'object' ? 'text-destructive' : 'text-muted-foreground')}>
        {state === 'done' ? 'Saved to your downloads.' : typeof state === 'object' ? `Backup failed: ${state.error}` : ''}
      </span>
    </div>
  );
}
