import {
  ArrowUpCircleIcon,
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  NetworkIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShieldBanIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getConfig, type Section, str } from '@/lib/api/uci';
import { formatBytes, formatNumber } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import { homeDhcp, readDeviceDns } from '../dns/device-dns';
import { SERVER } from '../remote-access/sections';
import { guestLabels, isGuestNetwork } from '../wifi-guest/guest';
import {
  type AdGuardStatus,
  checkUpdates,
  enableAdGuard,
  getAdGuardStatus,
  installVersion,
  repairAdGuard,
  setCredentials,
  setupAdGuard,
} from './api';
import { blockedShare, type Credentials, describeState, networkRows, updateChoice, validateCredentials, versionLabel } from './model';

interface Around {
  /** Devices on the home network are told to use another DNS server (the DNS page). */
  ownServer: boolean;
  /** Remote access's devices may open the router's pages (its zone accepts input). */
  remoteAdmin: boolean | undefined;
  guestLabel: (zone: string) => string | undefined;
}

async function loadAround(): Promise<Around> {
  const [dhcp, firewall, milkflint] = await Promise.all([
    getConfig('dhcp'),
    getConfig('firewall'),
    getConfig('milkflint').catch((): Section[] => []),
  ]);
  const zone = firewall.find((s) => s['.type'] === 'zone' && str(s, 'name') === SERVER);
  const labels = guestLabels(milkflint);
  return {
    ownServer: readDeviceDns(homeDhcp(dhcp)).own,
    remoteAdmin: zone === undefined ? undefined : str(zone, 'input') === 'ACCEPT',
    guestLabel: (z) => (isGuestNetwork(z) ? labels[z] : undefined),
  };
}

type Busy = { what: string } | undefined;

function Problem({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {children}
        {action}
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
  const [c, setC] = useState<Credentials>({ user: initialUser, password: '', again: '' });
  const [tried, setTried] = useState(false);
  const errors = validateCredentials(c);
  const show = (k: keyof Credentials): string | undefined => (tried || (k === 'again' && c.again !== '') ? errors[k] : undefined);
  const set = (k: keyof Credentials, v: string): void => {
    setC({ ...c, [k]: v });
  };
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
            set('user', e.target.value.trim());
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
            set('password', e.target.value);
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
            set('again', e.target.value);
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

function UpdatesCard({ s, busy, run }: { s: AdGuardStatus; busy: Busy; run: (what: string, fn: () => Promise<unknown>) => void }): ReactElement {
  const u = s.update ?? undefined;
  const choice = updateChoice(s.version, u);
  const [back, setBack] = useState<string>();
  const working = u?.busy === true;
  const checked = u?.checked === null || u?.checked === undefined ? undefined : new Date(u.checked * 1000);
  return (
    <Card>
      <CardHeading
        icon={ArrowUpCircleIcon}
        title="Updates"
        description="From MilkFlint’s package feed, built from AdGuard Home’s source. Its own updater is off."
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={working || busy !== undefined}
            onClick={() => {
              run('check', checkUpdates);
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
          <InfoRow label="Newest in the feed">
            {choice.latest === undefined ? (u?.error === 'feed' ? 'couldn’t reach the feed' : 'not checked yet') : versionLabel(choice.latest)}
          </InfoRow>
          {checked !== undefined && <InfoRow label="Checked">{checked.toLocaleString()}</InfoRow>}
        </div>
        {working && u.action === 'install' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Installing; the router answers DNS itself meanwhile.
          </p>
        )}
        {!working && u?.action === 'install' && u.ok === false && (
          <p className="text-sm text-destructive">The last install didn’t work{u.log !== null && u.log !== undefined && u.log !== '' ? `: ${u.log.split('\n').slice(-2).join(' ')}` : '.'}</p>
        )}
        {!working && u?.action === 'install' && u.ok === true && <p className="text-sm text-success">Installed {versionLabel(u.installed)}.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {choice.newer && (
            <Button
              size="sm"
              disabled={working || busy !== undefined}
              onClick={() => {
                run('install', () => installVersion(''));
              }}
            >
              Update to {versionLabel(choice.latest)}
            </Button>
          )}
          {choice.pinned && !choice.newer && choice.latest !== undefined && choice.latest !== choice.installed && (
            <Button
              size="sm"
              variant="outline"
              disabled={working || busy !== undefined}
              onClick={() => {
                run('install', () => installVersion(''));
              }}
            >
              Back to the newest
            </Button>
          )}
        </div>
        {choice.earlier.length > 0 && (
          <Field id="agh-back" label="Go back" hint="If an update misbehaves: an earlier version from the feed, kept until you update again." className="pb-0">
            <div className="flex gap-2">
              <Select value={back ?? ''} onValueChange={setBack}>
                <SelectTrigger id="agh-back" className="min-w-0 flex-1">
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
                disabled={back === undefined || working || busy !== undefined}
                onClick={() => {
                  if (back !== undefined) run('install', () => installVersion(back));
                }}
              >
                <RotateCcwIcon /> Install
              </Button>
            </div>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

export function AdGuardHomePage(): ReactElement {
  const { data: s, error, loading, refresh } = usePoll(getAdGuardStatus, 5000);
  const around = useLoad(loadAround).data;
  const [busy, setBusy] = useState<Busy>();
  const [failure, setFailure] = useState<string>();
  const [note, setNote] = useState<string>();

  const run = (what: string, fn: () => Promise<unknown>, done?: string): void => {
    setBusy({ what });
    setFailure(undefined);
    setNote(undefined);
    fn().then(
      () => {
        setBusy(undefined);
        if (done !== undefined) setNote(done);
        refresh();
      },
      (err: unknown) => {
        setBusy(undefined);
        setFailure(errorMessage(err));
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
          <InfoIcon />
          <AlertTitle>Not in this firmware</AlertTitle>
          <AlertDescription>AdGuard Home’s package isn’t installed on this router.</AlertDescription>
        </Alert>
      </>
    );
  }

  const state = describeState(s);
  const share = blockedShare(s.stats);
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
        {failure !== undefined && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>That didn’t work</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {note !== undefined && (
          <Alert variant="success">
            <InfoIcon />
            <AlertTitle>Done</AlertTitle>
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}
        {ap && (
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>Not used in access point mode</AlertTitle>
            <AlertDescription>
              Another router gives your devices their addresses and answers their DNS lookups, so AdGuard Home here would filter nothing: it stays
              off. Run it on that router, or on another server your devices use.
            </AlertDescription>
          </Alert>
        )}
        {!ap && on && s.state === 'fallback' && (
          <Problem title={s.reason === 'stopped' ? 'AdGuard Home has stopped: lookups aren’t filtered' : 'AdGuard Home isn’t answering: lookups aren’t filtered'}>
            Your devices still get answers, from the router itself, with the DNS page’s servers. MilkFlint sends their lookups back to AdGuard Home once
            it answers{s.reason === 'stopped' ? ', and starts it again every few minutes' : ''}. Its messages are on the{' '}
            <a href="#/logs" className="font-medium underline">
              Logs page
            </a>
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
            The DNS page tells your home network’s devices to ask another server on your network directly, so AdGuard Home on the router doesn’t
            filter their lookups (only the guest networks’ and Remote access’s).{' '}
            <a href="#/dns" className="font-medium underline">
              DNS page
            </a>
          </Problem>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card className="xl:col-span-2">
            <CardHeading
              icon={ShieldBanIcon}
              title="AdGuard Home"
              description={state.text}
              action={
                <>
                  <Badge variant={state.tone === 'success' ? 'success' : state.tone === 'warning' ? 'warning' : 'secondary'}>{state.label}</Badge>
                  {s.configured === true && !ap && (
                    <Switch
                      aria-label="AdGuard Home"
                      checked={on}
                      disabled={busy !== undefined}
                      onCheckedChange={(v) => {
                        run('enable', () => enableAdGuard(v));
                      }}
                    />
                  )}
                </>
              }
            />
            <CardContent className="flex flex-col gap-4">
              {s.configured !== true && !ap ? (
                <>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    Choose the user name and password for its web interface: turning it on writes its first settings (no lists yet: you choose
                    them there), so its setup wizard never runs. Your devices keep asking the router; it sends their lookups through AdGuard
                    Home, then on to the DNS page’s servers.
                  </p>
                  <CredentialsForm
                    initialUser="admin"
                    submitLabel="Turn on AdGuard Home"
                    busy={busy?.what === 'setup'}
                    onSubmit={(c) => {
                      run('setup', () => setupAdGuard(c.user, c.password), 'AdGuard Home is on. It answers once it has started; choose its lists in its web interface.');
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    <div className="divide-y">
                      <InfoRow label="Version">{versionLabel(s.version)}</InfoRow>
                      <InfoRow label="Memory">{s.memory_kb === null || s.memory_kb === undefined ? '–' : formatBytes(s.memory_kb * 1024)}</InfoRow>
                    </div>
                    <div className="divide-y">
                      <InfoRow label={`Lookups, last ${String(s.stats?.hours ?? 24)} hours`}>
                        {s.stats === null || s.stats === undefined ? '–' : formatNumber(s.stats.queries)}
                      </InfoRow>
                      <InfoRow label="Blocked">
                        {s.stats === null || s.stats === undefined ? '–' : `${formatNumber(s.stats.blocked)}${share === undefined ? '' : ` (${share})`}`}
                      </InfoRow>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
            {s.configured === true && !ap && (
              <CardFooter className="flex flex-wrap items-center gap-3">
                <Button asChild disabled={!on || s.running !== true}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    Open AdGuard Home <ExternalLinkIcon />
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground">
                  {s.url}, from your home network
                  {around?.remoteAdmin === true ? ' and Remote access' : ''}. Sign in as {s.user ?? 'your user'}.
                </p>
              </CardFooter>
            )}
          </Card>

          {s.configured === true && (
            <Card>
              <CardHeading
                icon={KeyRoundIcon}
                title="Sign-in"
                description="The user name and password for AdGuard Home’s web interface. Saving restarts it; the router answers DNS meanwhile."
              />
              <CardContent>
                <CredentialsForm
                  key={s.user ?? ''}
                  initialUser={s.user ?? 'admin'}
                  submitLabel="Save"
                  busy={busy?.what === 'credentials'}
                  onSubmit={(c) => {
                    run('credentials', () => setCredentials(c.user, c.password), 'Saved: sign in to AdGuard Home with the new password.');
                  }}
                />
              </CardContent>
            </Card>
          )}

          {s.configured === true && <UpdatesCard s={s} busy={busy} run={run} />}

          <Card className="xl:col-span-2">
            <CardHeading icon={NetworkIcon} title="With the rest of the router" />
            <CardContent>
              <ul className="flex max-w-4xl list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
                <li>
                  Your devices keep asking the router (its own address, port 53): it hands their lookups to AdGuard Home with their own address,
                  and AdGuard Home sends what it doesn’t block to the router’s DNS, which uses the{' '}
                  <a href="#/dns" className="font-medium text-foreground underline">
                    DNS page
                  </a>
                  ’s servers, cache and rebinding protection. Change those there, not in AdGuard Home.
                </li>
                <li>
                  Names on your network (name.lan) and custom names come from the DNS page too. AdGuard Home’s own DNS rewrites work, but keep
                  names in one place.
                </li>
                <li>
                  AdGuard Home knows devices by address. To give one its own rules, give it an address that doesn’t change (a reservation on
                  the{' '}
                  <a href="#/clients" className="font-medium text-foreground underline">
                    Clients page
                  </a>
                  ), or a whole network its rules by its subnet:
                </li>
              </ul>
              {rows.length > 0 && (
                <div className="mt-3 max-w-2xl divide-y rounded-lg border px-3">
                  {rows.map((r) => (
                    <InfoRow key={r.label} label={r.label}>
                      <span className="font-mono text-xs">{r.subnets.join(', ')}</span>
                    </InfoRow>
                  ))}
                </div>
              )}
              <p className="mt-3 max-w-4xl text-xs text-muted-foreground">
                Remote access’s devices reach its web interface only when Remote access lets them open the router’s pages. The guest networks
                and the internet never do.
              </p>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeading icon={ScaleIcon} title="License" />
            <CardContent className="flex max-w-4xl flex-col gap-2 text-sm text-muted-foreground">
              <p>
                AdGuard Home is free software, under the GNU General Public License version 3. MilkFlint builds it from its source, unchanged,
                and installs it; MilkFlint isn’t made or endorsed by AdGuard, whose trademark the name is.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <a href={s.licenses?.license} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
                  License (GPL-3.0)
                </a>
                <a href={s.licenses?.notices} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
                  Third-party notices
                </a>
                {version !== undefined && (
                  <a
                    href={`https://github.com/AdguardTeam/AdGuardHome/tree/v${version}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline"
                  >
                    Source code (v{version})
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
