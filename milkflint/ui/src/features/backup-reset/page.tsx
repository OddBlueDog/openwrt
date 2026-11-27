// Backup & reset: save the settings to a file (restoring one is LuCI's, in a
// new tab), restart the router, or erase everything. A factory reset asks
// for "reset" typed out, and says what the router is afterwards: no
// password and Wi-Fi off, so only a cable reaches it.
import { ArrowRightIcon, DownloadIcon, LoaderCircleIcon, PowerIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/utils';
import { BackupFirst } from './backup-first';
import { useRestart, useSaveBackup } from './queries';

type Busy = 'restarting' | 'resetting' | undefined;

/** What a factory reset leaves the router as. */
const AFTER_RESET =
  'The router comes back as new, at http://192.168.1.1/, with no admin password and Wi-Fi off: only a device on a cable can sign in.';

/** One of the page's actions: what it does on the left, its button on the right (below on a phone). */
function Action({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <div className="max-w-prose text-sm text-muted-foreground">{children}</div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">{action}</div>
    </section>
  );
}

export function BackupResetPage(): ReactElement {
  const [dialog, setDialog] = useState<'restart' | 'reset'>();
  const [confirmText, setConfirmText] = useState('');
  const backupMutation = useSaveBackup();
  const restartMutation = useRestart();
  const saving = backupMutation.isPending;
  const error = backupMutation.error === null ? undefined : errorMessage(backupMutation.error);
  const busy: Busy = !restartMutation.isPending
    ? undefined
    : restartMutation.variables === 'restart'
      ? 'restarting'
      : 'resetting';

  const backup = (): void => {
    backupMutation.mutate();
  };

  const run = (what: 'restart' | 'reset'): void => {
    setDialog(undefined);
    restartMutation.mutate(what);
  };

  return (
    <>
      <PageHeader
        title="Backup & reset"
        description="Save your settings to a file, restart the router, or go back to factory settings."
      />
      <div className="flex flex-col gap-4">
        {busy !== undefined && (
          <Alert variant="info" role="status">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>{busy === 'restarting' ? 'Restarting…' : 'Resetting to factory settings…'}</AlertTitle>
            <AlertDescription>
              {busy === 'restarting'
                ? 'This usually takes about a minute. The page reloads when the router is back.'
                : `${AFTER_RESET} Plug a cable in to set it up again.`}
            </AlertDescription>
          </Alert>
        )}
        {error !== undefined && (
          <Alert variant="destructive" role="alert">
            <TriangleAlertIcon />
            <AlertTitle>Backup failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Card className="gap-0 divide-y py-0">
          <Action
            title="Backup"
            action={
              <>
                <Button variant="outline" onClick={backup} disabled={busy !== undefined || saving}>
                  {saving ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />} Download backup
                </Button>
                <Button variant="ghost" asChild>
                  <a href="/cgi-bin/luci/admin/system/flash">
                    Restore in LuCI <ArrowRightIcon />
                  </a>
                </Button>
              </>
            }
          >
            <p>All your settings in one file, passwords included. Keep a copy before big changes.</p>
            <p className="mt-1">Restoring one is done in LuCI, OpenWrt’s own interface, on its Backup / Flash Firmware page.</p>
          </Action>
          <Action
            title="Restart"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('restart');
                }}
                disabled={busy !== undefined}
              >
                <PowerIcon /> Restart router
              </Button>
            }
          >
            Internet and Wi-Fi drop for about a minute. Settings are kept; you’ll need to sign in again.
          </Action>
          <Action
            title="Factory reset"
            action={
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmText('');
                  setDialog('reset');
                }}
                disabled={busy !== undefined}
              >
                <RotateCcwIcon /> Reset to factory settings
              </Button>
            }
          >
            Erases every setting and goes back to how the router was after the firmware was installed. {AFTER_RESET}
          </Action>
        </Card>
      </div>

      <Dialog
        open={dialog !== undefined}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
      >
        <DialogContent>
          {dialog === 'reset' ? (
            <>
              <DialogHeader>
                <DialogTitle>Erase all settings?</DialogTitle>
                <DialogDescription>
                  This can’t be undone except by restoring a backup. Type{' '}
                  <span className="font-mono font-semibold text-foreground">reset</span> to confirm.
                </DialogDescription>
              </DialogHeader>
              <Note tone="warning" icon={<TriangleAlertIcon />} title="Afterwards Wi-Fi is off">
                {AFTER_RESET}
              </Note>
              <BackupFirst />
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-reset">Type reset to confirm</Label>
                <Input
                  id="confirm-reset"
                  autoComplete="off"
                  value={confirmText}
                  onChange={(e) => {
                    setConfirmText(e.target.value);
                  }}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDialog(undefined);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={confirmText.trim().toLowerCase() !== 'reset'}
                  onClick={() => {
                    run('reset');
                  }}
                >
                  Erase and restart
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Restart the router?</DialogTitle>
                <DialogDescription>The internet and Wi-Fi drop for about a minute while it restarts.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDialog(undefined);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    run('restart');
                  }}
                >
                  Restart
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
