// AdGuard Home: ad and tracker blocking for every device, set up in its own
// web interface. MilkFlint turns it on and off, keeps the DNS chain around it
// (the router side's monitor sends devices' lookups to it while it answers)
// and installs its updates from MilkFlint's feed. The page opens on the
// answer (on or off, what it's doing now: lookups and the share blocked),
// then what's wrong if anything, its sign-in and updates, and how it fits
// with the rest of the router.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  InfoIcon,
  LoaderCircleIcon,
  PackageIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PackageUpdatesCard } from '@/components/package-updates';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ApplyState } from '@/hooks/use-apply';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { formatBytes, formatNumber } from '@/lib/format';
import { href, pageLink } from '@/lib/router';
import { useSession } from '@/lib/session';
import { FEED_SITE, versionLabel } from '@/lib/package-versions';
import { errorMessage } from '@/lib/utils';
import { InsightsCard } from './insights';
import {
  type AdGuardStatus,
  enableAdGuard,
  enableRouterLogin,
  type Around,
  openAdGuard,
  repairAdGuard,
  setCredentials,
  setFallback,
  setupAdGuard,
} from './api';
import {
  adGuardOpenTarget,
  blockedShare,
  type Credentials,
  credentialsSchema,
  describeState,
  networkRows,
  type Tone,
} from './model';
import { adguardQueries, useAdGuardWrite } from './queries';

type Busy = { what: string } | undefined;

const link = 'link font-medium underline-offset-4';

function Problem({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <div>{children}</div>
        {action}
      </AlertDescription>
    </Alert>
  );
}

const BADGE: Record<Tone, 'success' | 'warning' | 'info' | 'secondary'> = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  muted: 'secondary',
};

function Stat({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-base font-semibold tabular">{children}</dd>
    </div>
  );
}

function RouterPasswordNote(): ReactElement | null {
  const session = useSession();
  if (session.status !== 'authenticated' || session.adminPassword === 'set') return null;
  const old = session.adminPassword === 'old-default';
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{old ? 'Your router still uses the default password' : 'Your router has no admin password yet'}</AlertTitle>
      <AlertDescription>
        Anyone who can sign in here can open AdGuard Home too. {old ? 'Change it' : 'Set one'} on{' '}
        <Link {...pageLink('admin-password')} className={link}>
          Router access
        </Link>
        .
      </AlertDescription>
    </Alert>
  );
}

function CredentialsForm({
  initialUser,
  submitLabel,
  busy,
  onSubmit,
}: {
  initialUser: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (c: Credentials) => void;
}): ReactElement {
  const saved = useMemo((): Credentials => ({ user: initialUser, password: '', again: '' }), [initialUser]);
  const { form } = useSettingsForm({ schema: credentialsSchema, saved, onSave: onSubmit });
  const c = useFormValues(form);
  const [tried, setTried] = useState(false);
  const errors: Partial<Record<keyof Credentials, string>> = formErrors(credentialsSchema, c);
  const show = (k: keyof Credentials): string | undefined => (tried || (k === 'again' && c.again !== '') ? errors[k] : undefined);
  return (
    <form
      className="divide-y"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (Object.keys(errors).length === 0) onSubmit(c);
      }}
    >
      <Field id="agh-user" label="User name" error={show('user')}>
        <Input
          id="agh-user"
          autoComplete="username"
          spellCheck={false}
          value={c.user}
          onChange={(e) => {
            form.setFieldValue('user', e.target.value.trim());
          }}
        />
      </Field>
      <Field id="agh-password" label="Password" hint="At least 8 characters." error={show('password')}>
        <Input
          id="agh-password"
          type="password"
          autoComplete="new-password"
          value={c.password}
          onChange={(e) => {
            form.setFieldValue('password', e.target.value);
          }}
        />
      </Field>
      <Field id="agh-again" label="Password again" error={show('again')}>
        <Input
          id="agh-again"
          type="password"
          autoComplete="new-password"
          value={c.again}
          onChange={(e) => {
            form.setFieldValue('again', e.target.value);
          }}
        />
      </Field>
      <div className="flex justify-end pt-3">
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircleIcon className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** What devices' lookups do while it's down, once it has started: fail (the default) or answered unfiltered. */
function FallbackCard({
  s,
  busy,
  run,
}: {
  s: AdGuardStatus;
  busy: Busy;
  run: (what: string, fn: () => Promise<unknown>, done?: string) => void;
}): ReactElement {
  const on = s.fallback === true;
  return (
    <Card>
      <CardHeading
        title="If it stops answering"
        description="When AdGuard Home crashes or hangs after it has started. While it starts (after a reboot, or a change made here), the router answers your devices’ lookups itself, unfiltered, either way."
        action={
          <Switch
            aria-label="Answer them unfiltered"
            checked={on}
            disabled={busy !== undefined}
            onCheckedChange={(v) => {
              run(
                'fallback',
                () => setFallback(v),
                v ? 'Saved: the router answers lookups itself while it’s down.' : 'Saved: lookups fail while it’s down.',
              );
            }}
          />
        }
      />
      <CardContent className="border-t pt-4">
        <p className="max-w-prose text-sm">
          {on ? (
            <>
              <span className="font-medium">Answer them unfiltered.</span> The router answers your devices’ lookups itself until
              AdGuard Home is back: the internet keeps working, but ads and trackers get through meanwhile.
            </>
          ) : (
            <>
              <span className="font-medium">Let them fail.</span> Your devices’ lookups keep going to AdGuard Home and fail until
              it’s back, so nothing gets through unfiltered, but nothing new loads either. A stopped AdGuard Home is started again
              every 30 seconds. Turn this on to have the router answer them meanwhile.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/** Sign-in mode and password: use MilkFlint's router login (default) or a separate user name and password. */
function SignInCard({
  s,
  busy,
  run,
}: {
  s: AdGuardStatus;
  busy: Busy;
  run: (what: string, fn: () => Promise<unknown>, done?: string) => void;
}): ReactElement {
  const routerLogin = s.router_login === true;
  const [wantSeparate, setWantSeparate] = useState(false);
  if (!routerLogin && wantSeparate) setWantSeparate(false);
  const switchOn = routerLogin && !wantSeparate;
  const showForm = !switchOn;
  return (
    <Card>
      <CardHeading title="Sign-in" description="How you sign in to AdGuard Home’s web interface." />
      <CardContent className="flex flex-col gap-4 border-t pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Label htmlFor="agh-router-login">Use router login</Label>
            <p className="max-w-prose text-xs text-muted-foreground">
              {switchOn
                ? 'Opening AdGuard Home from this page signs you in for an hour, and signing out here signs you out there too. Direct sign-in at its address stays locked, so there’s no second password to keep.'
                : routerLogin
                  ? 'Still on until you save a separate user name and password below. Switch back on to keep using your router login.'
                  : 'Turn on to sign straight in from this page with your router login instead of keeping a separate password. Direct sign-in at its address will be locked.'}
            </p>
          </div>
          <Switch
            id="agh-router-login"
            checked={switchOn}
            disabled={busy !== undefined}
            onCheckedChange={(v) => {
              if (!v) {
                setWantSeparate(true);
              } else if (routerLogin) {
                setWantSeparate(false);
              } else {
                run(
                  'router_login',
                  enableRouterLogin,
                  'Saved: open AdGuard Home from this page to sign in with your router login.',
                );
              }
            }}
          />
        </div>
        {!showForm ? (
          <RouterPasswordNote />
        ) : (
          <div className="flex flex-col gap-3 border-t pt-4">
            <p className="max-w-prose text-sm text-muted-foreground">
              {routerLogin
                ? 'Set a user name and password for AdGuard Home’s web interface and third-party apps. Saving turns off router login and restarts AdGuard Home; the router answers DNS meanwhile.'
                : 'Change the user name or password for AdGuard Home’s web interface and third-party apps. Saving restarts AdGuard Home; the router answers DNS meanwhile.'}
            </p>
            <CredentialsForm
              key={s.user ?? ''}
              initialUser={s.user ?? 'admin'}
              submitLabel={routerLogin ? 'Use this password' : 'Save'}
              busy={busy?.what === 'credentials'}
              onSubmit={(c) => {
                run(
                  'credentials',
                  () => setCredentials(c.user, c.password),
                  'Saved: sign in to AdGuard Home with the new password.',
                );
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SetupSection({
  defaultRouterLogin,
  busy,
  run,
}: {
  defaultRouterLogin: boolean;
  busy: Busy;
  run: (what: string, fn: () => Promise<unknown>, done?: string) => void;
}): ReactElement {
  const [routerLogin, setRouterLogin] = useState(defaultRouterLogin);
  const doneNote = 'AdGuard Home is on. It answers once it has started; choose its lists in its web interface.';
  return (
    <div className="flex flex-col gap-4 border-t px-5 pt-4 pb-5">
      <p className="max-w-prose text-sm">
        Turning it on writes its first settings (no lists yet: you choose them in its web interface), so its setup wizard never
        runs. Your devices keep asking the router, which sends their lookups through AdGuard Home, then on to the DNS page’s
        servers. It runs as a program of its own, using some of the router’s memory. If it stops answering once it has started,
        their lookups fail until it’s back, so nothing gets through unfiltered: you can have the router answer them meanwhile
        instead, once it’s on.
      </p>
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor="agh-setup-router-login">Use router login</Label>
          <p className="max-w-prose text-xs text-muted-foreground">
            {routerLogin
              ? 'Opening AdGuard Home from this page signs you straight in using your router session. Direct sign-in at its address stays locked.'
              : 'Set a separate user name and password for AdGuard Home’s web interface and third-party apps.'}
          </p>
        </div>
        <Switch
          id="agh-setup-router-login"
          checked={routerLogin}
          disabled={busy !== undefined}
          onCheckedChange={setRouterLogin}
        />
      </div>
      {routerLogin ? (
        <>
          <RouterPasswordNote />
          <div className="flex justify-end">
            <Button
              disabled={busy !== undefined}
              onClick={() => {
                run('setup', () => setupAdGuard({ routerLogin: true }), doneNote);
              }}
            >
              {busy?.what === 'setup' && <LoaderCircleIcon className="animate-spin" />}
              Turn on AdGuard Home
            </Button>
          </div>
        </>
      ) : (
        <div className="border-t">
          <CredentialsForm
            initialUser="admin"
            submitLabel="Turn on AdGuard Home"
            busy={busy?.what === 'setup'}
            onSubmit={(c) => {
              run('setup', () => setupAdGuard({ routerLogin: false, user: c.user, password: c.password }), doneNote);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** What it's doing now, in one line over the state's sentence. */
function headline(s: AdGuardStatus): string {
  if (s.mode === 'ap') return 'Not used in access point mode';
  if (s.configured !== true) return 'Not set up yet';
  if (s.enabled !== true) return 'Lookups aren’t filtered';
  const share = blockedShare(s.stats);
  switch (s.state ?? 'starting') {
    case 'active':
      return share === undefined ? 'Filtering your devices’ lookups' : `Blocking ${share} of lookups`;
    case 'starting':
      return 'Starting up';
    case 'fallback':
      return 'Not filtering right now';
    case 'blocking':
      return 'Your devices’ lookups are failing';
    case 'off':
      return 'Lookups aren’t filtered';
  }
}

function Answer({
  s,
  around,
  busy,
  run,
}: {
  s: AdGuardStatus;
  around: Around | undefined;
  busy: Busy;
  run: (what: string, fn: () => Promise<unknown>, done?: string) => void;
}): ReactElement {
  const state = describeState(s);
  const ap = s.mode === 'ap';
  const on = s.enabled === true;
  const configured = s.configured === true;
  const share = blockedShare(s.stats);
  const stats = s.stats ?? undefined;
  const routerLogin = s.router_login === true;
  const target = s.url === undefined ? undefined : adGuardOpenTarget(s.url, window.location.hostname);
  // this page opened at another address than AdGuard Home's (Remote access's, IPv6): where it should be instead
  const offHost = routerLogin && target !== undefined && !target.sameHost && target.host !== '' ? target.host : undefined;
  const openWithRouterLogin = (): void => {
    if (target === undefined) return;
    // Open the tab synchronously inside the click so browsers don't block it as a popup.
    const tab = window.open('', '_blank');
    if (tab !== null) tab.opener = null;
    run('open', async () => {
      try {
        await openAdGuard();
        if (tab !== null) tab.location.replace(target.url);
        else window.location.assign(target.url);
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  };
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-4">
          <Badge variant={BADGE[state.tone]}>{state.label}</Badge>
          {configured && !ap && (
            <Switch
              aria-label="AdGuard Home on"
              checked={on}
              disabled={busy !== undefined}
              onCheckedChange={(v) => {
                run('enable', () => enableAdGuard(v));
              }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">{headline(s)}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{state.text}</p>
        </div>
        {configured && !ap && !on && (
          <p className="max-w-prose text-sm">
            Turning it on starts it with the lists you chose in it. It runs as a program of its own, using some of the router’s
            memory, and until it answers, the router answers lookups itself, unfiltered.
          </p>
        )}
      </div>
      {configured && !ap && on && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t px-5 py-4 sm:grid-cols-4">
          <Stat label={`Lookups, last ${String(stats?.hours ?? 24)} hours`}>
            {stats === undefined ? '–' : formatNumber(stats.queries)}
          </Stat>
          <Stat label="Blocked">
            {stats === undefined ? '–' : `${formatNumber(stats.blocked)}${share === undefined ? '' : ` (${share})`}`}
          </Stat>
          <Stat label="Memory">{s.memory_kb === null || s.memory_kb === undefined ? '–' : formatBytes(s.memory_kb * 1024)}</Stat>
          <Stat label="Version">{versionLabel(s.version)}</Stat>
        </dl>
      )}
      {configured && !ap && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-4">
          {on && s.running === true ? (
            routerLogin ? (
              offHost !== undefined ? (
                // the sign-in cookie can't reach AdGuard Home from this address: this page at the home address can
                <Button asChild>
                  <a href={`http://${offHost}/${href('adguardhome')}`}>Open this page at {offHost}</a>
                </Button>
              ) : (
                <Button disabled={busy !== undefined} onClick={openWithRouterLogin}>
                  {busy?.what === 'open' ? <LoaderCircleIcon className="animate-spin" /> : null}
                  Open AdGuard Home <ExternalLinkIcon />
                </Button>
              )
            ) : (
              <Button asChild>
                <a href={s.url} target="_blank" rel="noreferrer">
                  Open AdGuard Home <ExternalLinkIcon />
                </a>
              </Button>
            )
          ) : (
            // nothing answers there while it's off or not running
            <Button disabled>
              Open AdGuard Home <ExternalLinkIcon />
            </Button>
          )}
          <p className="min-w-0 text-sm text-muted-foreground">
            Its lists and rules are set there:{' '}
            <span className="font-mono text-xs whitespace-nowrap text-foreground">{s.url}</span>, from your home network
            {around?.remoteAdmin === true ? ' and Remote access' : ''}.{' '}
            {routerLogin ? (
              <>
                {offHost === undefined ? (
                  'Open it from here to sign straight in with your router login.'
                ) : (
                  <>
                    Opened from here, its sign-in can’t reach it: the router login carries over only from the router’s home
                    address. Open this page at <span className="font-mono text-xs text-foreground">http://{offHost}/</span>{' '}
                    (signing in there), then open AdGuard Home from it.
                  </>
                )}
              </>
            ) : (
              <>Sign in as {s.user ?? 'your user'}.</>
            )}
          </p>
        </div>
      )}
      {!configured && !ap && <SetupSection defaultRouterLogin={s.router_login ?? true} busy={busy} run={run} />}
    </Card>
  );
}

export function AdGuardHomePage(): ReactElement {
  const { data: s, error, loading, refresh } = useLive(adguardQueries.status());
  const around = useQuery(adguardQueries.around()).data;
  const [busy, setBusy] = useState<Busy>();
  const [toast, setToast] = useState<ApplyState>({ phase: 'idle' });
  // every write, AdGuard Home's own sign-in included: the status is asked again once it went through
  const write = useAdGuardWrite();

  const run = (what: string, fn: () => Promise<unknown>, done?: string): void => {
    setBusy({ what });
    setToast({ phase: 'idle' });
    write.mutateAsync(fn).then(
      () => {
        setBusy(undefined);
        if (done !== undefined) setToast({ phase: 'done', nothingChanged: false, note: done });
      },
      (err: unknown) => {
        setBusy(undefined);
        setToast({ phase: 'failed', message: errorMessage(err) });
        refresh();
      },
    );
  };

  const header = (
    <PageHeader
      title="AdGuard Home"
      description="Blocks ads and trackers for every device on your networks, with the lists and rules you choose in its own web interface."
    />
  );
  if (s === undefined) {
    return (
      <>
        {header}
        {error !== undefined && !loading ? <LoadError error={error} retry={refresh} /> : <FormSkeleton />}
      </>
    );
  }
  if (!s.installed) {
    return (
      <>
        {header}
        <Alert>
          <PackageIcon />
          <AlertTitle>Not in this firmware</AlertTitle>
          <AlertDescription>
            <p>
              AdGuard Home’s package isn’t installed on this router. MilkFlint’s releases include it, off until you turn it on:
              upgrade to get it. Until then, the DNS page can send lookups to a filtering DNS service instead.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link {...pageLink('upgrade')}>
                  Upgrade <ChevronRightIcon />
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link {...pageLink('dns')}>
                  DNS page <ChevronRightIcon />
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const broken = (s.settings ?? []).filter((x) => x.breaks);
  const notes = (s.settings ?? []).filter((x) => !x.breaks);
  const ap = s.mode === 'ap';
  const on = s.enabled === true;
  const rows = networkRows(s.networks, around?.guestLabel ?? (() => undefined));
  const version = /^([0-9][0-9a-z.]*)-r/.exec(s.version ?? '')?.[1];
  const repair = (
    <Button
      size="sm"
      variant="outline"
      className="mt-2 w-fit"
      disabled={busy !== undefined}
      onClick={() => {
        run('repair', repairAdGuard, 'Put back. AdGuard Home restarted; the router answered DNS itself meanwhile.');
      }}
    >
      {busy?.what === 'repair' ? <LoaderCircleIcon className="animate-spin" /> : <WrenchIcon />} Put back
    </Button>
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <ApplyStatus state={toast} />
        <Answer s={s} around={around} busy={busy} run={run} />
        {ap && (
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>Not used in access point mode</AlertTitle>
            <AlertDescription>
              <p>
                Another router gives your devices their addresses and answers their DNS lookups, so AdGuard Home here would filter
                nothing: it stays off. Run it on that router, or on another server your devices use.
              </p>
              <Link {...pageLink('mode')} className={`mt-1 inline-flex items-center gap-0.5 ${link}`}>
                Operating mode <ChevronRightIcon className="size-4" />
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {!ap && on && s.state === 'fallback' && (
          <Problem
            title={
              s.reason === 'stopped'
                ? 'AdGuard Home has stopped: lookups aren’t filtered'
                : 'AdGuard Home isn’t answering: lookups aren’t filtered'
            }
          >
            Your devices still get answers, from the router itself, with the DNS page’s servers. MilkFlint sends their lookups
            back to AdGuard Home once it answers
            {s.reason === 'stopped' ? ', and starts it again every few minutes' : ''}. Its messages are on the{' '}
            <Link {...pageLink('logs')} className={link}>
              Logs page
            </Link>
            .
          </Problem>
        )}
        {!ap && on && s.state === 'blocking' && (
          <Problem
            title={
              s.reason === 'stopped'
                ? 'AdGuard Home has stopped: your devices’ lookups fail'
                : 'AdGuard Home isn’t answering: your devices’ lookups fail'
            }
          >
            Nothing gets through unfiltered: their lookups keep going to AdGuard Home
            {s.reason === 'stopped' ? ', which is started again every 30 seconds' : ''}, and work again once it answers. To keep
            DNS working meanwhile, turn on “Answer them unfiltered” below. Its messages are on the{' '}
            <Link {...pageLink('logs')} className={link}>
              Logs page
            </Link>
            .
          </Problem>
        )}
        {!ap && on && broken.length > 0 && (
          <Problem title="A setting changed in AdGuard Home breaks the DNS chain" action={repair}>
            <ul className="mt-1 list-disc pl-4">
              {broken.map((b) => (
                <li key={b.key}>{b.what}</li>
              ))}
            </ul>
          </Problem>
        )}
        {!ap && on && broken.length === 0 && notes.length > 0 && (
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>Changed in AdGuard Home</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc pl-4">
                {notes.map((b) => (
                  <li key={b.key}>{b.what}</li>
                ))}
              </ul>
              {repair}
            </AlertDescription>
          </Alert>
        )}
        {!ap && on && around?.ownServer === true && (
          <Problem title="Your devices use another DNS server">
            The DNS page tells your home network’s devices to ask another server on your network directly, so AdGuard Home on the
            router doesn’t filter their lookups (only the guest networks’ and Remote access’s).{' '}
            <Link {...pageLink('dns')} className={link}>
              DNS page
            </Link>
          </Problem>
        )}

        {/* what it's seeing: read once a minute, only while it's on and answering */}
        {s.configured === true && !ap && on && s.running === true && <InsightsCard />}

        {s.configured === true && !ap && <FallbackCard s={s} busy={busy} run={run} />}

        {s.configured === true && (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <SignInCard s={s} busy={busy} run={run} />
            <PackageUpdatesCard
              name="adguardhome"
              title="Updates"
              notes="From MilkFlint’s package feed, packaging AdGuard Home’s official releases, offered once MilkFlint has tested them with this release. Its own updater is off."
              installing="the router answers DNS itself meanwhile"
              backNote="Your settings stay, in the format that version reads."
              onInstalled={refresh}
            />
          </div>
        )}

        <Card>
          <CardHeading title="With the rest of the router" description="How lookups reach it, and how it tells devices apart." />
          <CardContent className="flex flex-col gap-4">
            <ul className="flex max-w-4xl list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
              <li>
                Your devices keep asking the router (its own address, port 53): it hands their lookups to AdGuard Home with their
                own address, and AdGuard Home sends what it doesn’t block to the router’s DNS, which uses the{' '}
                <Link {...pageLink('dns')} className={link}>
                  DNS page
                </Link>
                ’s servers, cache and rebinding protection. Change those there, not in AdGuard Home.
              </li>
              <li>
                Names on your network (name.lan) and custom names come from the DNS page too. AdGuard Home’s own DNS rewrites
                work, but keep names in one place.
              </li>
              <li>
                AdGuard Home knows devices by address. To give one its own rules, give it an address that doesn’t change (a
                reservation on the{' '}
                <Link {...pageLink('clients')} className={link}>
                  Clients page
                </Link>
                ), or a whole network its rules by its subnet:
              </li>
            </ul>
            {rows.length > 0 && (
              <div className="flex max-w-2xl flex-col border-y">
                {rows.map((r) => (
                  // the subnets wrap rather than being cut short on a phone
                  <div
                    key={r.label}
                    className="flex flex-col gap-0.5 border-b py-2.5 text-sm last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="shrink-0 text-muted-foreground">{r.label}</span>
                    <span className="min-w-0 font-mono text-xs break-all sm:text-right">{r.subnets.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="max-w-4xl text-xs text-muted-foreground">
              Remote access’s devices reach its web interface only when Remote access lets them open the router’s pages. The guest
              networks and the internet never do.
            </p>
          </CardContent>
          <div className="flex flex-col gap-2 border-t px-5 pt-4 text-sm text-muted-foreground">
            <h3 className="font-medium text-foreground">License</h3>
            <p className="max-w-4xl">
              AdGuard Home is free software, under the GNU General Public License version 3. MilkFlint packages AdGuard’s official
              release binary, unchanged, with its own service settings, and offers its updates from MilkFlint’s own package feed.
              The release number after the version is MilkFlint’s build number, upstream’s plus 1000, so a same-named build from
              OpenWrt can’t replace it. MilkFlint isn’t made or endorsed by AdGuard, whose trademark the name is.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <a href={s.licenses?.license} target="_blank" rel="noreferrer" className={link}>
                License (GPL-3.0)
              </a>
              {s.licenses?.notices !== null && s.licenses?.notices !== undefined && s.licenses.notices !== '' && (
                <a href={s.licenses.notices} target="_blank" rel="noreferrer" className={link}>
                  Third-party notices
                </a>
              )}
              {version !== undefined && (
                <a
                  href={`https://github.com/AdguardTeam/AdGuardHome/tree/v${version}`}
                  target="_blank"
                  rel="noreferrer"
                  className={link}
                >
                  Source code (v{version})
                </a>
              )}
              {s.version !== null && s.version !== undefined && s.version !== '' && (
                <a
                  href={`${FEED_SITE}/sources/adguardhome/${s.version}/SOURCE.txt`}
                  target="_blank"
                  rel="noreferrer"
                  className={link}
                >
                  MilkFlint’s package ({s.version})
                </a>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
