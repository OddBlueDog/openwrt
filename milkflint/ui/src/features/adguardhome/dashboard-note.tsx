import { LoaderCircleIcon, ShieldAlertIcon, WrenchIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePoll } from '@/hooks/use-poll';
import { errorMessage } from '@/lib/utils';
import { getAdGuardStatus, repairAdGuard } from './api';
import { needsAttention } from './model';

/**
 * The Dashboard's warning while AdGuard Home is on but lookups go round it
 * (it isn't answering: devices get unfiltered DNS), or while a setting
 * changed in its own web interface breaks the DNS chain, with "Put back".
 * Nothing otherwise, nor where there's no AdGuard Home.
 */
export function AdGuardHomeNote(): ReactElement | null {
  // a firmware without it answers "not found": then nothing, quietly
  const { data, refresh } = usePoll(() => getAdGuardStatus().catch(() => undefined), 15000);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const { fallback, broken } = needsAttention(data);
  if (!fallback && broken.length === 0) return null;
  return (
    <Alert variant="warning">
      <ShieldAlertIcon />
      <AlertTitle>{fallback ? 'AdGuard Home isn’t filtering' : 'AdGuard Home’s settings break the DNS chain'}</AlertTitle>
      <AlertDescription>
        {fallback
          ? `It ${data?.reason === 'stopped' ? 'has stopped' : 'isn’t answering'}: your devices get answers from the router itself, unfiltered, until it does again.`
          : broken.map((b) => b.what).join(' ')}
        {failed !== undefined && <span className="text-destructive">{failed}</span>}
        <div className="mt-2 flex flex-wrap gap-2">
          {broken.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(undefined);
                repairAdGuard().then(
                  () => {
                    setBusy(false);
                    refresh();
                  },
                  (err: unknown) => {
                    setBusy(false);
                    setFailed(errorMessage(err));
                  },
                );
              }}
            >
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <WrenchIcon />} Put back
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <a href="#/adguardhome">AdGuard Home page</a>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
