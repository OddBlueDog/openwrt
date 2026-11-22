// The Upgrade page: what the router runs now, then the image to install.
// An image is uploaded to the router's RAM and checked there; nothing is
// installed until Install is confirmed. Keeping the settings starts on when
// a MilkFlint router gets a MilkFlint image (./keep.ts), and off otherwise
// with the reason; erasing them is the destructive choice, and the
// confirmation offers a backup first.
import { CheckCircle2Icon, CloudUploadIcon, FileIcon, LoaderCircleIcon, TriangleAlertIcon, XCircleIcon } from 'lucide-react';
import { type ChangeEvent, type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { usePoll } from '@/hooks/use-poll';
import { type Board, firmwareName, getBoard, getInfo } from '@/lib/api/system';
import { formatBytes, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn, errorMessage } from '@/lib/utils';
import { type RestartPhase, waitForRouterAndReload } from '../backup-reset/api';
import { BackupFirst } from '../backup-reset/backup-first';
import { type Check, checkImage, discardImage, startUpgrade, uploadImage, type Validation, validateImage } from './api';
import { erasedText, type KeepChoice, keepChoice } from './keep';

type Stage =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; progress: number }
  | { kind: 'checking'; name: string }
  | { kind: 'ready'; name: string; validation: Validation; check: Check; choice: KeepChoice }
  | { kind: 'upgrading'; since: number; phase: RestartPhase }
  | { kind: 'error'; message: string };

/** How long an upgrade usually takes, from Install until the router answers again. */
const UPGRADE_SECONDS = 120;
/** Anything bigger isn't a firmware image (the Flint 2's are 16–45 MB), and the upload goes to RAM. */
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
/** When Install was pressed (ms since 1970), kept over the reload so the page can tell how it went. */
const STARTED_KEY = 'milkflint.upgrade-started';
/** MilkFlint's published images: the public fork's releases */
const RELEASES = 'https://github.com/OddBlueDog/openwrt/releases';

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
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{PHASES[phase]}</span>
          <span className="text-xs text-muted-foreground">
            {phase === 'back'
              ? 'Sign in again to see the new firmware.'
              : left > 0
                ? 'Usually back in about 2 minutes.'
                : 'Taking a little longer than usual; still checking.'}
          </span>
        </div>
        <span
          className="text-2xl font-semibold tabular"
          aria-label={`${String(Math.floor(left / 60))} minutes ${String(left % 60)} seconds left`}
        >
          {String(Math.floor(left / 60))}:{String(left % 60).padStart(2, '0')}
        </span>
      </div>
      <Progress value={phase === 'back' ? 100 : (elapsed / UPGRADE_SECONDS) * 100} aria-label="Upgrade progress" />
    </div>
  );
}

/** A label above its value, one of the cells of the page's opening answer. */
function Cell({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** What the router runs now, and how the last upgrade went. */
function RunningNow({
  board,
  outcome,
}: {
  board: Board | undefined;
  outcome: { restarted: boolean; uptime: number } | undefined;
}): ReactElement {
  return (
    <Card className="gap-0 py-0">
      {outcome !== undefined && (
        <div className="border-b px-5 py-4">
          {outcome.restarted ? (
            <Note tone="success" icon={<CheckCircle2Icon />} title="Upgrade finished">
              The router restarted {formatDuration(outcome.uptime)} ago and runs{' '}
              {firmwareName(board?.release) ?? 'the new firmware'}.
            </Note>
          ) : (
            <Note tone="warning" icon={<TriangleAlertIcon />} title="The router didn’t restart">
              So the new firmware wasn’t installed. Upload the image again to retry; the{' '}
              <a href={href('logs')} className="font-medium link">
                system log
              </a>{' '}
              may say what stopped it.
            </Note>
          )}
        </div>
      )}
      <dl className="grid divide-y md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
        <Cell label="Running now">{firmwareName(board?.release) ?? '—'}</Cell>
        <Cell label="Model">{board?.model ?? '—'}</Cell>
        <Cell label="Kernel">{board?.kernel ?? '—'}</Cell>
      </dl>
    </Card>
  );
}

/** A file's detail on one line: the label, then its value. */
function Detail({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="grid gap-1 py-2.5 text-sm sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-all">{children}</dd>
    </div>
  );
}

export function UpgradePage(): ReactElement {
  const board = usePoll(getBoard, 60_000).data;
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  // set from the image when it's checked (./keep.ts)
  const [keep, setKeep] = useState(false);
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<{ restarted: boolean; uptime: number }>();
  const running = board?.release?.distribution;

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

  const upload = useCallback(
    async (file: File): Promise<void> => {
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
        const choice = keepChoice({ running, image: file.name, allowBackup: validation.allow_backup });
        setKeep(choice.keep);
        setStage({ kind: 'ready', name: file.name, validation, check, choice });
      } catch (err) {
        setStage({ kind: 'error', message: errorMessage(err) });
      }
    },
    [running],
  );

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
  const failedTests =
    ready === undefined
      ? []
      : Object.entries(ready.validation.tests ?? {})
          .filter(([, ok]) => !ok)
          .map(([name]) => name);
  const installable = ready !== undefined && (ready.validation.valid || (force && ready.validation.forceable === true));
  const erasing = !keep;

  return (
    <>
      <PageHeader
        title="Upgrade"
        description="Install a new firmware image. Upgrading from MilkFlint keeps your settings, unless you choose to erase them."
      />
      <div className="flex flex-col gap-4">
        <RunningNow board={board} outcome={stage.kind === 'idle' ? outcome : undefined} />

        <Card>
          <CardHeading
            title="Firmware image"
            description="A sysupgrade image for this router: a MilkFlint release, your own build, or one from openwrt.org."
          />
          <CardContent className="flex flex-col gap-4">
            {stage.kind === 'upgrading' ? (
              <>
                <Note tone="info" icon={<LoaderCircleIcon className="animate-spin" />} title="Upgrading… don’t unplug the router">
                  This takes about 2 minutes; the lights may flash. The page reloads when the router is back
                  {keep ? '' : ' (at http://192.168.1.1/, with factory settings)'}.
                </Note>
                <UpgradeCountdown since={stage.since} phase={stage.phase} />
              </>
            ) : stage.kind === 'uploading' || stage.kind === 'checking' ? (
              <div className="flex flex-col gap-2 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate font-medium">{stage.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {stage.kind === 'uploading' ? 'Uploading…' : 'Checking the image…'}
                  </span>
                </div>
                <Progress
                  value={stage.kind === 'uploading' ? stage.progress * 100 : 100}
                  aria-label={stage.kind === 'uploading' ? 'Upload progress' : 'Checking the image'}
                />
              </div>
            ) : ready !== undefined ? (
              <div className="flex flex-col gap-4">
                <dl className="divide-y border-y">
                  <Detail label="File">{ready.name}</Detail>
                  <Detail label="Size">{ready.check.size === undefined ? '—' : formatBytes(ready.check.size)}</Detail>
                  <Detail label="SHA-256">
                    <span className="font-mono text-xs font-normal">{ready.check.sha256 ?? '—'}</span>
                  </Detail>
                </dl>
                {ready.validation.valid ? (
                  <Note tone="success" icon={<CheckCircle2Icon />} title="The image fits this router">
                    Compare the SHA-256 with the one on the download page before installing.
                  </Note>
                ) : (
                  <Note tone="destructive" icon={<XCircleIcon />} title="This image doesn’t look right for this router">
                    {failedTests.length > 0 ? `Failed checks: ${failedTests.join(', ')}.` : 'It failed the image checks.'}
                    {ready.check.test_output !== undefined && ready.check.test_output !== '' && (
                      <pre className="mt-1 max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap">
                        {ready.check.test_output}
                      </pre>
                    )}
                  </Note>
                )}
                <div className="divide-y border-t">
                  <Field
                    id="up-keep"
                    label="Keep settings"
                    // why it can't be kept is the switch's state, so it shows in every theme
                    hint={ready.choice.allowed ? ready.choice.reason : undefined}
                    status={ready.choice.allowed ? undefined : ready.choice.reason}
                    why={
                      <div className="flex flex-col gap-1.5">
                        <p>
                          Kept, the router comes back with the same address, admin password and Wi-Fi. Erased:{' '}
                          {erasedText(ready.choice.kind)}
                        </p>
                        <p>
                          Settings kept from another firmware or version may not suit it, which is why only a MilkFlint image
                          keeps them to start with.
                        </p>
                        <p className="text-muted-foreground">
                          Erasing is <code className="font-mono text-foreground">sysupgrade -n</code>.
                        </p>
                      </div>
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Switch id="up-keep" checked={keep} disabled={!ready.choice.allowed} onCheckedChange={setKeep} />
                      <span className="text-sm">{keep ? 'Kept' : 'Erased'}</span>
                    </div>
                  </Field>
                  {!ready.validation.valid && ready.validation.forceable === true && (
                    <Field
                      id="up-force"
                      label="Install anyway"
                      hint="Only if you know this image is right; a wrong image can stop the router from starting."
                    >
                      <Switch id="up-force" checked={force} onCheckedChange={setForce} />
                    </Field>
                  )}
                </div>
                {erasing && (
                  <Note tone="warning" icon={<TriangleAlertIcon />} title="Installing this erases every setting">
                    {erasedText(ready.choice.kind)}
                  </Note>
                )}
              </div>
            ) : (
              <>
                {stage.kind === 'error' && (
                  <Note tone="destructive" icon={<TriangleAlertIcon />} title="Couldn’t check the image">
                    {stage.message}
                  </Note>
                )}
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center transition-colors duration-fast hover:bg-accent/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                    dragging && 'border-primary bg-primary-subtle hover:bg-primary-subtle',
                  )}
                >
                  <CloudUploadIcon className={cn('size-6 text-muted-foreground', dragging && 'text-primary')} aria-hidden />
                  <span className="text-sm font-medium">
                    {dragging ? 'Drop it to upload' : 'Choose a firmware file, or drop it here'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    It’s uploaded to the router and checked; nothing is installed yet.
                  </span>
                  <input type="file" className="sr-only" accept=".bin,.img,.gz,.itb" onChange={choose} />
                </label>
                <p className="text-sm text-muted-foreground">
                  MilkFlint’s images are on its{' '}
                  <a href={RELEASES} target="_blank" rel="noreferrer" className="font-medium link">
                    releases page
                  </a>
                  : take the one ending in sysupgrade.bin.
                </p>
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
                Install…
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{erasing ? 'Install and erase every setting?' : 'Install and keep your settings?'}</DialogTitle>
            <DialogDescription>
              The router installs <span className="font-mono text-xs break-all text-foreground">{ready?.name}</span> and restarts:
              it’s offline for about 2 minutes. Don’t unplug it while it upgrades.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-sm">
            {erasing ? (
              <Note tone="destructive" icon={<TriangleAlertIcon />} title="All settings are erased">
                {erasedText(ready?.choice.kind ?? 'unknown')} A backup brings them back, on{' '}
                <a href={href('backup-reset')} className="font-medium link">
                  Backup &amp; reset
                </a>
                .
              </Note>
            ) : (
              <Note tone="success" icon={<CheckCircle2Icon />} title="Settings are kept">
                It comes back with the same address, admin password and Wi-Fi.
              </Note>
            )}
            {force && (
              <Note tone="warning" icon={<TriangleAlertIcon />} title="It failed the image checks">
                It’s installed anyway, as you chose. A wrong image can stop the router from starting.
              </Note>
            )}
            <BackupFirst />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button variant={erasing || force ? 'destructive' : 'default'} onClick={() => void upgrade()}>
              {erasing ? 'Erase and install' : 'Install and restart'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
