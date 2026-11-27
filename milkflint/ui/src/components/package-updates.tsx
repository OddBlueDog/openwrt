// The Updates card for a package MilkFlint updates from its own feed
// (AdGuard Home, banIP): what's installed, the newest version tested with this
// release, Check, Update, and going back to an earlier one. The router side is
// rpcd milkflint.packages; installs run in the background and the card polls
// while one does.
import { LoaderCircleIcon, RotateCcwIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PackageName } from '@/lib/api/packages';
import { useLive } from '@/lib/query/use-live';
import { componentQueries, usePackageAction } from './queries';
import { lastRunMessage, newestText, updateChoice, versionLabel } from '@/lib/package-versions';
import { errorMessage } from '@/lib/utils';

export function PackageUpdatesCard({
  name,
  title,
  notes,
  installing,
  backNote,
  onInstalled,
}: {
  name: PackageName;
  title: string;
  notes?: ReactNode;
  /** What happens meanwhile, after "Installing <package>". */
  installing?: string;
  /** What going back does to the package's settings, in one line. */
  backNote?: string;
  /** Called when an install the card started has finished well. */
  onInstalled?: () => void;
}): ReactElement {
  const { data: u } = useLive(componentQueries.packageStatus(name));
  const [back, setBack] = useState<string>();
  const act = usePackageAction(name);
  const starting = act.isPending;
  const failed = act.error === null ? undefined : errorMessage(act.error);
  const choice = updateChoice(u?.installed, u);
  const working = u?.busy === true;
  const disabled = working || starting;
  const checked = u?.checked === null || u?.checked === undefined ? undefined : new Date(u.checked * 1000);

  // an install that ran to the end well, seen once
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working && u?.action === 'install' && u.ok === true) onInstalled?.();
    wasWorking.current = working;
  }, [working, u?.action, u?.ok, onInstalled]);

  const label = name === 'banip' ? 'banIP' : 'AdGuard Home';
  const message = lastRunMessage(u, label);

  return (
    <Card>
      <CardHeading
        title={title}
        description={notes}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              act.mutate({ action: 'check' });
            }}
          >
            {working && u.action === 'check' && <LoaderCircleIcon className="animate-spin" />}
            Check
          </Button>
        }
      />
      <CardContent className="flex flex-col gap-3">
        <div className="divide-y">
          <InfoRow label="Installed">
            {versionLabel(choice.installed)}
            {choice.pinned && ' (kept back)'}
          </InfoRow>
          <InfoRow label="Newest tested">{newestText(u, choice.latest)}</InfoRow>
          {checked !== undefined && <InfoRow label="Checked">{checked.toLocaleString()}</InfoRow>}
        </div>
        {working && u.action === 'install' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {u.waiting === true
              ? 'Waiting for another update to finish.'
              : `Installing ${label}${installing === undefined ? '' : `; ${installing}`}.`}
          </p>
        )}
        {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
        {message !== undefined && (
          <p className={message.tone === 'success' ? 'text-sm text-success' : 'text-sm text-destructive'}>{message.text}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {choice.newer && (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => {
                act.mutate({ action: 'install', version: '' });
              }}
            >
              Update to {versionLabel(choice.latest)}
            </Button>
          )}
          {choice.pinned && !choice.newer && choice.latest !== undefined && choice.latest !== choice.installed && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                act.mutate({ action: 'install', version: '' });
              }}
            >
              Back to the newest
            </Button>
          )}
        </div>
        {choice.earlier.length > 0 && (
          <Field
            id={`${name}-back`}
            label="Go back"
            hint="If an update misbehaves: an earlier tested version, kept until you update again."
            className="pb-0"
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Select value={back ?? ''} onValueChange={setBack}>
                  <SelectTrigger id={`${name}-back`} className="min-w-0 flex-1">
                    <SelectValue placeholder="An earlier version" />
                  </SelectTrigger>
                  <SelectContent>
                    {choice.earlier.map((v) => (
                      <SelectItem key={v} value={v}>
                        {versionLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={back === undefined || disabled}
                  onClick={() => {
                    if (back !== undefined) act.mutate({ action: 'install', version: back });
                  }}
                >
                  <RotateCcwIcon /> Install
                </Button>
              </div>
              {backNote !== undefined && <p className="text-xs text-muted-foreground">{backNote}</p>}
            </div>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}
