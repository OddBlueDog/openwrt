import { ShieldAlertIcon, ShieldXIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePoll } from '@/hooks/use-poll';
import { formatNumber } from '@/lib/format';
import { getStatus } from './api';
import { describeState } from './model';

/**
 * The Dashboard's line about banIP while it's on: what it's doing, how many
 * addresses it blocks and what it blocked in the last hour; a warning when
 * it stopped with an error. Nothing while it's off, nor where there's no
 * banIP.
 */
export function BanipNote(): ReactElement | null {
  // a firmware without it answers "not found": then nothing, quietly
  const { data } = usePoll(() => getStatus().catch(() => undefined), 30000);
  if (data?.installed !== true || data.enabled !== true || data.state === 'ap' || data.state === undefined) return null;
  const words = describeState(data);
  if (data.state === 'error' || data.state === 'stopped') {
    return (
      <Alert variant="warning">
        <ShieldAlertIcon />
        <AlertTitle>banIP isn’t blocking</AlertTitle>
        <AlertDescription>
          {words.text}
          <div className="mt-2">
            <Button size="sm" variant="outline" asChild>
              <a href="#/banip">banIP page</a>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <a
      href="#/banip"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-xs transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ShieldXIcon className="size-4 text-primary" aria-hidden="true" />
      <span className="font-medium">banIP: {words.label.toLowerCase()}</span>
      <span className="text-muted-foreground tabular">
        {data.elements !== null && data.elements !== undefined
          ? `${formatNumber(data.elements)} addresses blocked`
          : 'loading its lists'}
        {data.drops !== undefined ? `, ${formatNumber(data.drops.hour)} blocked in the last hour` : ''}
      </span>
    </a>
  );
}
