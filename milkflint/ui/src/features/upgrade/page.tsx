import { CheckCircle2Icon, CloudUploadIcon, FileIcon, LoaderCircleIcon, ShieldAlertIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react';
import { type ChangeEvent, type ReactElement, useCallback, useEffect, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { usePoll } from '@/hooks/use-poll';
import { firmwareName, getBoard, getInfo } from '@/lib/api/system';
import { formatBytes, formatDuration } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { type RestartPhase, waitForRouterAndReload } from '../backup-reset/api';
import { type Check, checkImage, discardImage, startUpgrade, uploadImage, type Validation, validateImage } from './api';

type Stage =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; progress: number }
  | { kind: 'checking'; name: string }
  | { kind: 'ready'; name: string; validation: Validation; check: Check }
  | { kind: 'upgrading'; since: number; phase: RestartPhase }
  | { kind: 'error'; message: string };

/** How long an upgrade usually takes, from Install until the router answers again. */
const UPGRADE_SECONDS = 120;
/** Anything bigger isn't a firmware image (the Flint 2's are 16–45 MB), and the upload goes to RAM. */
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
/** When Install was pressed (ms since 1970), kept over the reload so the page can tell how it went. */
const STARTED_KEY = 'milkflint.upgrade-started';

const PHASES: Record<RestartPhase, string> = {
  starting: 'Starting the upgrade…',
  offline: 'Installing and restarting; the router is offline',
  back: 'The router is back. Reloading…',
};

/** Where the upgrade has got to, a countdown to the router's usual return, then a note that it's taking longer. */
function UpgradeCountdown({ since, phase }: { since: number; phase: RestartPhase }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  const elapsed = Math.min(UPGRADE_SECONDS, Math.floor((now - since) / 1000));
  const left = UPGRADE_SECONDS - elapsed;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{PHASES[phase]}</span>
          <span className="text-xs text-muted-foreground">
            {phase === 'back' ? 'Sign in again to see the new firmware.' : left > 0 ? 'Usually back in about 2 minutes.' : 'Taking a little longer than usual; still checking.'}
          </span>
        </div>
        <span className="font-mono text-2xl font-medium tabular-nums">
          {String(Math.floor(left / 60))}:{String(left % 60).padStart(2, '0')}
        </span>
      </div>
      <Progress value={phase === 'back' ? 100 : (elapsed / UPGRADE_SECONDS) * 100} />
    </div>
  );
}

export function UpgradePage(): ReactElement {
  const board = usePoll(getBoard, 60_000).data;
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  // off by default: a fresh start avoids settings the new firmware doesn't expect
  const [keep, setKeep] = useState(false);
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<{ restarted: boolean; uptime: number }>();

  // After an upgrade's reload (and signing in again): did the router restart?
  // If it was up for longer than since Install, it didn't.
  useEffect(() => {
    let started = NaN;
    try {
      started = Number(sessionStorage.getItem(STARTED_KEY) ?? NaN);
    } catch {
      // storage blocked: nothing to report
    }
    if (Number.isNaN(started)) return;
    void getInfo()
      .then((info) => {
        setOutcome({ restarted: info.uptime < (Date.now() - started) / 1000, uptime: info.uptime });
        try {
          sessionStorage.removeItem(STARTED_KEY);
        } catch {
          // shown once more next time, no harm
        }
      })
      .catch(() => undefined);
  }, []);

  const upload = useCallback(async (file: File): Promise<void> => {
    if (file.size > MAX_IMAGE_BYTES) {
      setStage({ kind: 'error', message: `${file.name} is ${formatBytes(file.size)}, too big for a firmware image.` });
      return;
    }
    setForce(false);
    try {
      setStage({ kind: 'uploading', name: file.name, progress: 0 });
      await uploadImage(file, (progress) => {
        setStage({ kind: 'uploading', name: file.name, progress });
      });
      setStage({ kind: 'checking', name: file.name });
      const [validation, check] = await Promise.all([validateImage(), checkImage()]);
      setKeep(false);
      setStage({ kind: 'ready', name: file.name, validation, check });
    } catch (err) {
      setStage({ kind: 'error', message: errorMessage(err) });
    }
  }, []);

  // A firmware file dropped anywhere on the page is uploaded while the drop
  // zone shows; at other times a drop does nothing (rather than the browser
  // opening the file and leaving the page).
  const canDrop = stage.kind === 'idle' || stage.kind === 'error';
  useEffect(() => {
    let depth = 0; // dragenter/dragleave come for every element crossed
    const enter = (e: DragEvent): void => {
      depth += 1;
      if (canDrop && e.dataTransfer?.types.includes('Files') === true) setDragging(true);
    };
    const leave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
    };
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (canDrop && file !== undefined) void upload(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [canDrop, upload]);

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) void upload(file);
  };

  const discard = async (): Promise<void> => {
    await discardImage().catch(() => undefined);
    setStage({ kind: 'idle' });
  };

  const upgrade = async (): Promise<void> => {
    setConfirming(false);
    setOutcome(undefined);
    const since = Date.now();
    try {
      sessionStorage.setItem(STARTED_KEY, String(since));
    } catch {
      // no report after the reload, the upgrade still runs
    }
    setStage({ kind: 'upgrading', since, phase: 'starting' });
    try {
      await startUpgrade(keep, force);
    } catch {
      // the router may already be going down
    }
    await waitForRouterAndReload((phase) => {
      setStage({ kind: 'upgrading', since, phase });
    });
  };

  const ready = stage.kind === 'ready' ? stage : undefined;
  const failedTests = ready === undefined ? [] : Object.entries(ready.validation.tests ?? {}).filter(([, ok]) => !ok).map(([name]) => name);
  const installable = ready !== undefined && (ready.validation.valid || (force && ready.validation.forceable === true));

  return (
    <>
      <PageHeader title="Upgrade" description="Install a new firmware image." />
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeading icon={CloudUploadIcon} title="Firmware image" description="A sysupgrade image for this router (from your own build, or openwrt.org)." />
          <CardContent className="flex flex-col gap-4">
            {outcome !== undefined && stage.kind === 'idle' && (
              outcome.restarted ? (
                <Alert variant="success">
                  <CheckCircle2Icon />
                  <AlertTitle>Upgrade finished</AlertTitle>
                  <AlertDescription>
                    The router restarted {formatDuration(outcome.uptime)} ago and runs {firmwareName(board?.release) ?? 'the new firmware'}.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>The router didn&apos;t restart</AlertTitle>
                  <AlertDescription>So the new firmware wasn&apos;t installed. Upload the image again to retry; the system log may say what stopped it.</AlertDescription>
                </Alert>
              )
            )}
            {stage.kind === 'upgrading' ? (
              <>
                <Alert variant="info">
                  <LoaderCircleIcon className="animate-spin" />
                  <AlertTitle>Upgrading… don&apos;t unplug the router</AlertTitle>
                  <AlertDescription>
                    This takes about 2 minutes; the lights may flash. The page reloads when the router is back
                    {keep ? '' : ' (at http://192.168.1.1/, with factory settings)'}.
                  </AlertDescription>
                </Alert>
                <UpgradeCountdown since={stage.since} phase={stage.phase} />
              </>
            ) : stage.kind === 'uploading' || stage.kind === 'checking' ? (
              <div className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm">
                  <FileIcon className="size-4 text-muted-foreground" />
                  <span className="font-medium">{stage.name}</span>
                  <span className="ml-auto text-muted-foreground">{stage.kind === 'uploading' ? 'Uploading…' : 'Checking the image…'}</span>
                </div>
                <Progress value={stage.kind === 'uploading' ? stage.progress * 100 : 100} />
              </div>
            ) : ready !== undefined ? (
              <div className="flex flex-col gap-3">
                <div className="divide-y rounded-lg border px-4">
                  <InfoRow label="File">{ready.name}</InfoRow>
                  <InfoRow label="Size">{ready.check.size === undefined ? '—' : formatBytes(ready.check.size)}</InfoRow>
                  <InfoRow label="SHA-256">
                    <span className="font-mono text-[11px] break-all whitespace-normal">{ready.check.sha256 ?? '—'}</span>
                  </InfoRow>
                </div>
                {ready.validation.valid ? (
                  <Alert variant="success">
                    <CheckCircle2Icon />
                    <AlertTitle>The image fits this router</AlertTitle>
                    <AlertDescription>Compare the SHA-256 with the one on the download page before installing.</AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <XCircleIcon />
                    <AlertTitle>This image doesn&apos;t look right for this router</AlertTitle>
                    <AlertDescription>
                      {failedTests.length > 0 ? `Failed checks: ${failedTests.join(', ')}.` : 'It failed the image checks.'}
                      {ready.check.test_output !== undefined && ready.check.test_output !== '' && (
                        <pre className="mt-1 max-h-32 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{ready.check.test_output}</pre>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                <Field id="up-keep" label="Keep settings" hint={
                    ready.validation.allow_backup === false
                      ? "This image can't keep the current settings."
                      : 'Off (recommended): the router starts with factory settings, and you set it up again. Settings kept from another firmware or version may not suit this one.'
                  }>
                  <Switch id="up-keep" checked={keep} disabled={ready.validation.allow_backup === false} onCheckedChange={setKeep} />
                </Field>
                {!ready.validation.valid && ready.validation.forceable === true && (
                  <Field id="up-force" label="Install anyway" hint="Only if you know this image is right; a wrong image can stop the router from starting.">
                    <Switch id="up-force" checked={force} onCheckedChange={setForce} />
                  </Field>
                )}
              </div>
            ) : (
              <>
                {stage.kind === 'error' && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>Couldn&apos;t check the image</AlertTitle>
                    <AlertDescription>{stage.message}</AlertDescription>
                  </Alert>
                )}
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors hover:bg-accent/50',
                    dragging && 'border-primary bg-primary/5 hover:bg-primary/5',
                  )}
                >
                  <CloudUploadIcon className={cn('size-6 text-muted-foreground', dragging && 'text-primary')} />
                  <span className="text-sm font-medium">{dragging ? 'Drop it to upload' : 'Choose a firmware file, or drop it here'}</span>
                  <span className="text-xs text-muted-foreground">It&apos;s uploaded to the router and checked; nothing is installed yet.</span>
                  <input type="file" className="sr-only" accept=".bin,.img,.gz,.itb" onChange={choose} />
                </label>
              </>
            )}
          </CardContent>
          {ready !== undefined && (
            <CardFooter className="justify-end">
              <Button variant="ghost" onClick={() => void discard()}>
                Discard
              </Button>
              <Button
                disabled={!installable}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Install
              </Button>
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeading icon={ShieldAlertIcon} title="Running now" />
          <CardContent className="divide-y">
            <InfoRow label="Firmware">{firmwareName(board?.release) ?? '—'}</InfoRow>
            <InfoRow label="Model">{board?.model ?? '—'}</InfoRow>
            <InfoRow label="Kernel">{board?.kernel ?? '—'}</InfoRow>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install {ready?.name}?</DialogTitle>
            <DialogDescription>
              The router restarts and is offline for a few minutes. {keep ? 'Settings are kept.' : 'All settings are erased.'} Don&apos;t unplug it while it upgrades.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button variant={force ? 'destructive' : 'default'} onClick={() => void upgrade()}>
              Install and restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
