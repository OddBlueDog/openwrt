import { ArrowRightIcon, FlaskConicalIcon, LoaderCircleIcon, LogOutIcon, SmartphoneIcon } from 'lucide-react';
import { type ReactElement, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSubPath } from '@/lib/router';
import { BenchView } from './bench-view';
import { HistoryCard } from './history-card';
import { benchMember, type MemberState, useMember } from './member';

const JOIN_PATH = '#/test-bench/join';

/** The code as it's typed: base32 letters and digits, a dash after four. */
function formatCode(s: string): string {
  const raw = s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

function JoinForm({ state, onJoin }: { state: MemberState; onJoin: (code: string, name: string) => Promise<void> }): ReactElement {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const busy = state.status === 'joining';
  const submit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(undefined);
    try {
      await onJoin(code, name.trim());
    } catch {
      // the member keeps the reason
    }
  };
  const shown = error ?? state.error;
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FlaskConicalIcon className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Join a test bench</h1>
        <p className="text-sm text-muted-foreground">
          Type the code the bench shows, or scan its QR code with this device&apos;s camera. No admin password needed.
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-xs">
        {state.status === 'closed' && state.error !== undefined && (
          <Alert variant="info">
            <AlertDescription>This device is no longer on the bench ({state.error}). Join again with the code.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="bench-code">Code</Label>
          <Input
            id="bench-code"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            className="h-12 text-center font-mono text-xl tracking-[0.2em]"
            onChange={(e) => {
              setCode(formatCode(e.target.value));
            }}
            aria-invalid={shown !== undefined && state.status !== 'closed'}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bench-device-name">This device&apos;s name</Label>
          <Input
            id="bench-device-name"
            value={name}
            maxLength={32}
            placeholder="Optional: the router names it otherwise"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        {shown !== undefined && state.status !== 'closed' && <p className="text-sm text-destructive">{shown}</p>}
        <Button type="submit" disabled={busy || code.replace('-', '').length !== 8}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <ArrowRightIcon />} Join
        </Button>
      </form>
      <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <a href="#/" className="hover:text-foreground">
          Sign in as admin
        </a>
        <ThemeToggle className="w-28" />
      </div>
    </div>
  );
}

/** While a run is on, keep the screen on where the browser allows it (HTTPS pages only). */
function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator) || !window.isSecureContext) return;
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    navigator.wakeLock.request('screen').then(
      (l) => {
        if (cancelled) void l.release();
        else lock = l;
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      void lock?.release();
    };
  }, [on]);
}

/** A device's page for a bench: no admin sign-in, works on a phone. */
export function JoinPage(): ReactElement {
  const sub = useSubPath();
  const member = benchMember();
  const state = useMember(member);
  const started = useRef(false);
  const token = /^join\/([A-Za-z0-9_-]{22})$/.exec(sub)?.[1];
  const runOn = state.run !== undefined && (state.poll?.run?.state === 'scheduled' || state.poll?.run?.state === 'running');
  useWakeLock(runOn);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const back = await member.resume();
      if (!back && token !== undefined) await member.join({ token }).catch(() => undefined);
      // the token stays out of the address bar and the history once it's used
      if (token !== undefined) window.history.replaceState(null, '', JOIN_PATH);
    })();
  }, [member, token]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Logo className="size-8" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{state.poll?.bench.name ?? 'Test bench'}</span>
              <span className="truncate text-xs text-muted-foreground">MilkFlint test bench</span>
            </div>
            {state.status === 'in' && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void member.leave()}>
                <LogOutIcon /> Leave
              </Button>
            )}
          </div>
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
          {state.status === 'in' ? (
            <>
              <Alert variant="info">
                <SmartphoneIcon />
                <AlertDescription>
                  Keep this page open and in front while a run is on. A phone that locks or switches to another app stops its part of the run.
                </AlertDescription>
              </Alert>
              <BenchView member={member} state={state} />
              {member.session !== undefined && <HistoryCard reader={{ session: member.session }} />}
            </>
          ) : state.status === 'joining' && token !== undefined ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Joining the bench…
            </div>
          ) : (
            <div className="py-6 sm:py-12">
              <JoinForm
                state={state}
                onJoin={(code, name) => member.join({ code: code.replace('-', '') }, name === '' ? undefined : name)}
              />
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
