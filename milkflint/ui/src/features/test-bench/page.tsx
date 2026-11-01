import { FlaskConicalIcon, LoaderCircleIcon, type LucideIcon, PowerIcon, QrCodeIcon, TimerIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePoll } from '@/hooks/use-poll';
import { errorMessage } from '@/lib/utils';
import { type Bench, closeBench, coordinate, getStatus, newCode, openBench } from './api';
import { BenchView } from './bench-view';
import { HistoryCard } from './history-card';
import { benchMember, useMember } from './member';

function Step({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }): ReactElement {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function OpenCard({ onOpen }: { onOpen: (name: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState('Test bench');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onOpen(name.trim() === '' ? 'Test bench' : name.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeading icon={FlaskConicalIcon} title="Open a bench" description="Several of your devices test the network together, while the router records what it does" />
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ol className="flex flex-col gap-4">
          <Step icon={FlaskConicalIcon} title="Open a bench here">
            This device joins it and coordinates: it picks the plan and starts runs.
          </Step>
          <Step icon={QrCodeIcon} title="Add your other devices">
            Each scans the bench&apos;s QR code, or types its code on the router&apos;s sign-in page. They don&apos;t need the admin password, and can do
            nothing on the router but take part.
          </Step>
          <Step icon={TimerIcon} title="Run a plan">
            Every device runs its part at the same moment, by the router&apos;s clock, and any of them can stop it. Nothing runs until you press Start,
            and every run stops by itself.
          </Step>
        </ol>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 self-start rounded-xl border bg-muted/30 p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bench-name">Name</Label>
            <Input
              id="bench-name"
              value={name}
              maxLength={32}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />} Open the bench
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CloseButton({ onClose }: { onClose: () => Promise<void> }): ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <PowerIcon /> Close the bench
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close the bench?</DialogTitle>
            <DialogDescription>
              Every device leaves it, and its code and QR code stop working. A run that&apos;s on stops. Finished runs stay on the router.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onClose().finally(() => {
                  setBusy(false);
                  setOpen(false);
                });
              }}
            >
              Close the bench
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** This tab joins the open bench (once per bench), and coordinates it if nobody does. */
function useJoinOwnBench(bench: Bench | null | undefined, refresh: () => void): string | undefined {
  const member = benchMember();
  const state = useMember(member);
  const tried = useRef<string>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (bench === null || bench === undefined || tried.current === bench.id) return;
    if (state.status === 'in' && state.bench === bench.id) return;
    tried.current = bench.id;
    void (async () => {
      try {
        if (!(member.remembers(bench.id) && (await member.resume()))) await member.join({ token: bench.token });
        const me = member.getState().me;
        if ((bench.coordinator === null || bench.coordinator === undefined) && me !== undefined) await coordinate(me);
        setError(undefined);
        refresh();
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [bench, member, state.status, state.bench, refresh]);
  return error;
}

export function TestBenchPage(): ReactElement {
  const { data, error, loading, refresh } = usePoll(getStatus, 5000);
  const member = benchMember();
  const state = useMember(member);
  const bench = data?.bench;
  const joinError = useJoinOwnBench(bench, refresh);

  const header = (
    <PageHeader
      title="Test Bench"
      description="Test the network from several devices at once: latency under load, speeds, device to device, DNS, and what the router does meanwhile."
      actions={
        bench !== undefined && bench !== null ? (
          <CloseButton
            onClose={async () => {
              await closeBench();
              refresh();
            }}
          />
        ) : undefined
      }
    />
  );

  if (data === undefined) {
    return (
      <>
        {header}
        {error !== undefined && !loading ? <LoadError error={error} retry={refresh} /> : <FormSkeleton />}
      </>
    );
  }

  return (
    <>
      {header}
      {bench === null || bench === undefined ? (
        <div className="flex flex-col gap-4">
          <OpenCard
            onOpen={async (name) => {
              await openBench(name, false);
              refresh();
            }}
          />
          <HistoryCard reader={{ admin: true }} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {joinError !== undefined && <p className="text-sm text-destructive">This device couldn&apos;t join the bench: {joinError}</p>}
          <BenchView
            member={member}
            state={state}
            admin={{
              token: bench.token,
              code: bench.code,
              codeDisabled: bench.code_disabled,
              onNewCode: async () => {
                await newCode();
                refresh();
              },
              onTakeOver: async () => {
                if (state.me !== undefined) await coordinate(state.me);
                refresh();
              },
            }}
          />
          <HistoryCard reader={{ admin: true }} />
        </div>
      )}
    </>
  );
}
