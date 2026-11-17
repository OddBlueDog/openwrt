import { ShieldAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePoll } from '@/hooks/use-poll';
import { getStatusShared } from './api';
import { describeState } from './model';

/**
 * Home's warning when banIP is on but stopped or failed, whether or not its
 * widget is on Home. Nothing while it's working (the banIP widget shows what
 * it's doing), while it's off, nor where there's no banIP.
 */
export function BanipNote(): ReactElement | null {
  // a firmware without it answers "not found": then nothing, quietly
  const { data } = usePoll(() => getStatusShared().catch(() => undefined), 30000);
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
  // all's well: the banIP widget says so, for those who want it on Home
  return null;
}
