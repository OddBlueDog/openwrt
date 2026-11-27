import { ArrowRightIcon, LoaderCircleIcon, LogOutIcon, SmartphoneIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { type ReactElement, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Logo, Wordmark } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TooltipProvider } from '@/components/ui/tooltip';
import { pageLink, useSubPath } from '@/lib/router';
import { BenchView } from './bench-view';
import { HistoryCard } from './history-card';
import { benchMember, type MemberState, useMember } from './member';

const JOIN_PATH = '#/test-bench/join';

/** The code as it's typed: base32 letters and digits, a dash after four. */
function formatCode(s: string): string {
  const raw = s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

function JoinForm({
  state,
  onJoin,
}: {
  state: MemberState;
  onJoin: (code: string, name: string) => Promise<void>;
}): ReactElement {
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
        <span className="flex items-center gap-2.5">
          <Logo className="size-9" />
          <Wordmark className="text-lg" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Join a test bench</h1>
        <p className="text-sm text-muted-foreground">
          Someone on this network is testing it from several devices at once. Type the code their bench shows, or scan its QR code
          with this device&apos;s camera.
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
      <ul className="mt-6 flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>Joining needs no admin password, and lets this device do nothing on the router but take part.</li>
        <li>
          In a run it measures latency and, as the plan says, downloads and uploads test data (up to a limit) or loads a few
          sites&apos; icons.
        </li>
        <li>Nothing runs until the person coordinating presses Start, and every run stops by itself.</li>
      </ul>
      <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <Link {...pageLink('dashboard')} className="inline-block py-1 hover:text-foreground">
          Sign in as admin
        </Link>
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
      {state.status === 'in' ? (
        <div className="min-h-dvh">
          <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
              <Logo className="size-8 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <h1 className="truncate text-sm font-semibold">{state.poll?.bench.name ?? 'Test bench'}</h1>
                <span className="truncate text-xs text-muted-foreground">MilkFlint test bench</span>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => void member.leave()}>
                <LogOutIcon /> Leave
              </Button>
            </div>
          </header>
          <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
            <Alert variant="info">
              <SmartphoneIcon />
              <AlertDescription>
                Keep this page open and in front while a run is on. A phone that locks or switches to another app stops its part
                of the run.
              </AlertDescription>
            </Alert>
            <BenchView member={member} state={state} />
            {member.session !== undefined && state.me !== undefined && (
              <HistoryCard reader={{ session: member.session, member: state.me }} />
            )}
          </main>
        </div>
      ) : (
        <main className="grid min-h-dvh place-items-center px-4 py-10">
          {state.status === 'joining' && token !== undefined ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex items-center gap-2.5">
                <Logo className="size-9" />
                <Wordmark className="text-lg" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight">Joining the bench</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> A moment…
              </p>
            </div>
          ) : (
            <JoinForm
              state={state}
              onJoin={(code, name) => member.join({ code: code.replace('-', '') }, name === '' ? undefined : name)}
            />
          )}
        </main>
      )}
    </TooltipProvider>
  );
}
