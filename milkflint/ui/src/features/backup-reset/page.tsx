import { DownloadIcon, ExternalLinkIcon, LoaderCircleIcon, PowerIcon, RotateCcwIcon, ServerCogIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reboot } from '@/lib/api/system';
import { errorMessage } from '@/lib/utils';
import { downloadBackup, factoryReset, waitForRouterAndReload } from './api';

type Busy = 'restarting' | 'resetting' | undefined;

export function BackupResetPage(): ReactElement {
  const [dialog, setDialog] = useState<'restart' | 'reset'>();
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const [confirmText, setConfirmText] = useState('');

  const backup = async (): Promise<void> => {
    setError(undefined);
    try {
      const url = URL.createObjectURL(await downloadBackup());
      const a = document.createElement('a');
      a.href = url;
      a.download = `router-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const run = async (what: 'restart' | 'reset'): Promise<void> => {
    setDialog(undefined);
    setBusy(what === 'restart' ? 'restarting' : 'resetting');
    try {
      await (what === 'restart' ? reboot() : factoryReset());
    } catch {
      // the router may drop the connection while answering
    }
    await waitForRouterAndReload();
  };

  return (
    <>
      <PageHeader title="Backup & Reset" description="Save your settings, restart, or go back to factory settings." />
      <div className="flex flex-col gap-4">
        {busy !== undefined && (
          <Alert variant="info">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>{busy === 'restarting' ? 'Restarting…' : 'Resetting to factory settings…'}</AlertTitle>
            <AlertDescription>
              {busy === 'restarting'
                ? 'This usually takes about a minute. The page reloads when the router is back.'
                : 'Afterwards the router is at http://192.168.1.1/ with no password. Reconnect to its default Wi-Fi or a cable.'}
            </AlertDescription>
          </Alert>
        )}
        {error !== undefined && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Backup failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <Card>
            <CardHeading icon={DownloadIcon} title="Backup" description="All your settings in one file." />
            <CardContent className="text-sm text-muted-foreground">
              Keep a copy before big changes. Restoring it brings back every setting, including passwords.
            </CardContent>
            <CardFooter className="flex-wrap">
              <Button variant="outline" onClick={() => void backup()} disabled={busy !== undefined}>
                <DownloadIcon /> Download backup
              </Button>
              <Button variant="ghost" asChild>
                <a href="/cgi-bin/luci/admin/system/flash" target="_blank" rel="noreferrer">
                  Restore in LuCI <ExternalLinkIcon />
                </a>
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeading icon={ServerCogIcon} title="Restart" description="Internet and Wi-Fi drop for about a minute." />
            <CardContent className="text-sm text-muted-foreground">Settings are kept. You&apos;ll need to sign in again.</CardContent>
            <CardFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('restart');
                }}
                disabled={busy !== undefined}
              >
                <PowerIcon /> Restart router
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-destructive/40">
            <CardHeading icon={RotateCcwIcon} title="Factory reset" description="Erases every setting." />
            <CardContent className="text-sm text-muted-foreground">
              The router goes back to how it was after the firmware was installed: no password, default Wi-Fi, default address.
            </CardContent>
            <CardFooter>
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
            </CardFooter>
          </Card>
        </div>
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
                  This can&apos;t be undone except by restoring a backup. Type <span className="font-mono font-semibold">reset</span> to confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-reset" className="sr-only">
                  Type reset to confirm
                </Label>
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
                <Button variant="destructive" disabled={confirmText.trim().toLowerCase() !== 'reset'} onClick={() => void run('reset')}>
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
                <Button onClick={() => void run('restart')}>Restart</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
