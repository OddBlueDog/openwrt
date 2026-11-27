import { ShieldAlertIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { pageLink } from '@/lib/router';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLive } from '@/lib/query/use-live';
import { describeState } from './model';
import { banipQueries } from './queries';

/**
 * Home's warning when banIP is on but stopped or failed, whether or not its
 * widget is on Home. Nothing while it's working (the banIP widget shows what
 * it's doing), while it's off, nor where there's no banIP.
 */
export function BanipNote(): ReactElement | null {
  // a firmware without it answers "not found": then no data, and nothing shows
  const { data } = useLive(banipQueries.statusEvery30s());
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
              <Link {...pageLink('banip')}>banIP page</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  // all's well: the banIP widget says so, for those who want it on Home
  return null;
}
