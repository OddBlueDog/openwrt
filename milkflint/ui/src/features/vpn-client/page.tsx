// Send through a VPN: chosen devices' internet traffic goes through a VPN
// provider's WireGuard server (wg_out), with a kill switch. It opens on the
// answer (on or off, whether the tunnel is up and when it last heard from the
// server, who goes through it), then who uses it, protection and speed, and
// the provider's server details from their config file. "What this sets up"
// says in words what a save will do; the save result says what it did.
// Profiles ("USA", "France") sit above the settings once there's a tunnel or
// a profile: the active one is what the page edits, kept in step on every
// save; Activate switches to another, and the page watches its server answer.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { BookmarkPlusIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { evaluate } from '@tanstack/react-form';
import { type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import type { Change } from '@/lib/api/uci';
import { isConnected, type Tunnel, type WgInterface, type WgPeer } from '@/lib/api/wireguard';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Cell, CheckItem, NoWireGuard, Traffic } from '../remote-access/parts';
import { useRenewTunnel, vpnClientQueries } from './queries';
import {
  activeDnsOf,
  type ClientForm,
  clientErrors,
  clientFormKeys,
  clientFormSchema,
  describe,
  drift,
  type Errors,
  readConf,
  removal,
  serverNeedsFixing,
  serverText,
  summary,
  toChanges,
  tunnelLine,
  whoSummary,
} from './model';
import { CLIENT, CLIENT_TABLE } from './sections';
import { ClientFormCards, ConfigButton, ImportDialog } from './form-cards';
import { ProfileNameDialog, ProfilesCard } from './profiles-card';
import { activateChanges, formOf, type Profile, saveAsChanges, saveWithProfile, updateChanges } from './profiles';

/** The page's settings, where a profile's Edit goes while it's the active one. */
const SETTINGS = 'vpn-settings';
/** How long after an Activate the new server has to answer before the card says it hasn't, seconds. */
const ANSWER_WAIT = 30;

/** An Activate being watched: the profile, the one before it (and whether the VPN was on), and when (the router's clock). */
interface Watch {
  id: string;
  previous: string | undefined;
  wasOn: boolean;
  since: number;
}

/** A save's words, without the "Saved." it says when nothing else changed. */
const said = (lines: readonly string[]): string[] => lines.filter((l) => l !== 'Saved.');

interface Connection {
  tone: 'ok' | 'warn' | 'off';
  badge: string;
  headline: string;
  text: string;
  peer?: WgPeer;
  /** the watcher's word on the tunnel, when it has one: when the server stopped answering and what the devices get */
  note?: string;
}

const clockText = (epoch: number): string =>
  new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function connectionState(form: ClientForm, running: WgInterface | undefined, now: number, tunnel: Tunnel | null): Connection {
  const note = form.enabled ? tunnelLine(tunnel, form.killSwitch, clockText) : undefined;
  const c = connectionBase(form, running, now);
  // the stale-handshake text already says what the devices get: the watcher's line replaces it
  if (
    note !== undefined &&
    c.peer !== undefined &&
    c.badge === 'No answer' &&
    c.headline.startsWith('No answer from the server for')
  )
    return { ...c, text: note };
  return note === undefined ? c : { ...c, note };
}

function connectionBase(form: ClientForm, running: WgInterface | undefined, now: number): Connection {
  if (!form.enabled)
    return {
      tone: 'off',
      badge: 'Off',
      headline: 'Every device goes out directly',
      text: 'Nothing goes through the VPN until you turn it on.',
    };
  const peer = running?.peers[0];
  if (running === undefined || peer === undefined) {
    return {
      tone: 'warn',
      badge: 'Not up',
      headline: 'The tunnel isn’t up',
      text: 'Check the server’s address: the router has to find it first.',
    };
  }
  if (isConnected(peer, now)) {
    return {
      tone: 'ok',
      badge: 'Connected',
      headline: `Connected to ${peer.endpoint ?? serverText(form)}`,
      text: `Last handshake ${formatDuration(now - peer.latest_handshake)} ago.`,
      peer,
    };
  }
  if (peer.latest_handshake === 0) {
    return {
      tone: 'warn',
      badge: 'No answer',
      headline: 'No answer from the server yet',
      text: 'Check the keys and the server’s address and port.',
      peer,
    };
  }
  return {
    tone: 'warn',
    badge: 'No answer',
    headline: `No answer from the server for ${formatDuration(now - peer.latest_handshake)}`,
    text: form.killSwitch
      ? 'With the kill switch on, its devices have no internet meanwhile.'
      : 'Its devices go out directly meanwhile.',
    peer,
  };
}

export function VpnClientPage(): ReactElement {
  return (
    <>
      <PageHeader
        title="Send through a VPN"
        description="Send chosen devices’ internet traffic through a VPN provider’s WireGuard server, with a kill switch."
      />
      <PageBoundary>
        <VpnClient />
      </PageBoundary>
    </>
  );
}

function VpnClient(): ReactElement {
  // a refresh keeps what's drawn until the new answer is in, so the profiles card keeps its place (its focus, its open sheet)
  const settingsRead = useSuspenseQuery(vpnClientQueries.settings());
  const data = settingsRead.data;
  const loading = settingsRead.isFetching;
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>();
  const [details, setDetails] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [watch, setWatch] = useState<Watch>();
  const renew = useRef(false);
  // what a profiles-only change does once it's applied
  const after = useRef<(() => void) | undefined>(undefined);
  // a change to the profiles alone: the page's unsaved edits stay
  const keep = useRef(false);
  const poll = useLive(vpnClientQueries.status());
  const status = poll.data;
  const { mutate: renewTunnel } = useRenewTunnel();
  const saved = data.form;
  const schema = useMemo(() => clientFormSchema(data), [data]);
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: async (values) => {
      await saveForm(values);
    },
  });
  const { form: formApi, discard } = settings;
  const form = useFormValues(formApi);
  const onApplied = useCallback(() => {
    if (!keep.current) {
      discard();
      setImported(undefined);
    }
    keep.current = false;
    const then = after.current;
    after.current = undefined;
    then?.();
    // a new server, keys or port on a tunnel that was already up (every read is fresh already)
    if (renew.current) renewTunnel();
    renew.current = false;
  }, [discard, renewTunnel]);
  const { state, apply: applyNow } = useApply(onApplied);
  const apply: typeof applyNow = (changes, options) => {
    after.current = undefined;
    return applyNow(changes, options);
  };

  // an apply, or the refresh after it: until the new answer is in, what's drawn is stale and takes no new edits
  const working = state.phase === 'applying' || loading;
  const dirty = settings.dirty;
  // errors once a change or a save has checked the form
  const errors: Errors = dirty || settings.invalid ? clientErrors(form, data) : {};
  const invalid = Object.keys(errors).length > 0;
  const fix = dirty ? [] : drift(data);
  const running = status?.interfaces.find((i) => i.name === CLIENT);
  // the router's clock, which the handshakes are on
  const now = status?.now ?? 0;
  const blank = form.privateKey === '' && form.publicKey === '';
  const serverWrong = serverNeedsFixing(errors);

  // several fields at once (a config read in): each one that changes, as typed
  const update = (next: ClientForm): void => {
    for (const key of clientFormKeys) if (!evaluate(form[key], next[key])) formApi.setFieldValue(key, next[key]);
  };
  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]): void => {
    update({ ...form, [key]: value });
  };
  const useConf = (text: string): string | undefined => {
    const read = readConf(form, text);
    if ('error' in read) return read.error;
    setImported(read.notes);
    // a first config turns it on: that's what it's for
    update({ ...read.form, enabled: form.enabled || blank });
    // what it read in, to check before saving
    setDetails(true);
    return undefined;
  };

  const activeProfile = data.profiles.find((p) => p.id === data.active);
  const touchesPeer = (changes: readonly Change[]): boolean =>
    changes.some((c) => c.config === 'network' && 'section' in c && c.section === data.peerSection);
  // the router's clock now, from its last answer (and the time since, while the tab is in view)
  const routerNow = (): number | undefined =>
    status === undefined ? undefined : status.now + (poll.at === undefined ? 0 : (Date.now() - poll.at) / 1000);
  const applyProfiles = (changes: Change[], note: string, then?: () => void): void => {
    keep.current = true;
    renew.current = false;
    void apply(changes, { note });
    after.current = then;
  };
  /** Switches the live config to the profile; `watchIt`: say so if its server doesn't answer; `enabled`: false to leave the VPN off. */
  const activate = (p: Profile, watchIt: boolean, enabled = true): void => {
    const before = data.exists ? data.form : undefined;
    const target: ClientForm = { ...p.form, enabled };
    const changes = activateChanges(p, data, enabled);
    renew.current = touchesPeer(changes);
    keep.current = false;
    // only a tunnel that comes up afresh owes a handshake soon
    const moved =
      before?.enabled !== true ||
      serverText(before) !== serverText(target) ||
      before.publicKey !== target.publicKey ||
      before.privateKey !== target.privateKey;
    const since = routerNow();
    setWatch(
      watchIt && moved && since !== undefined
        ? { id: p.id, previous: data.active, wasOn: before?.enabled === true, since }
        : undefined,
    );
    void apply(changes, { note: [`Switched the VPN to ${p.name}.`, ...said(summary(before, target, data))].join(' ') });
  };
  const saveAs = (name: string): void => {
    // with unsaved changes, they're saved too, in the same apply
    const own = dirty ? toChanges(form, data) : [];
    renew.current = form.enabled && touchesPeer(own);
    keep.current = false;
    setWatch(undefined);
    setSavingAs(false);
    void apply([...own, ...saveAsChanges(name, form, data)], {
      note: [
        ...(dirty ? said(summary(data.exists ? data.form : undefined, form, data)) : []),
        `Saved these settings as ${name}, now the active profile.`,
      ].join(' '),
    });
  };
  const toSettings = (): void => {
    const el = document.getElementById(SETTINGS);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  };

  // an Activate whose server hasn't answered: no handshake from it since, after ANSWER_WAIT
  const watched = watch === undefined ? undefined : data.profiles.find((p) => p.id === watch.id);
  const peer = running?.peers[0];
  const answered =
    watch !== undefined &&
    peer !== undefined &&
    peer.public_key === watched?.form.publicKey &&
    peer.latest_handshake >= Math.floor(watch.since);
  const unanswered =
    watch !== undefined &&
    watched !== undefined &&
    data.active === watch.id &&
    state.phase === 'done' &&
    !answered &&
    now - watch.since >= ANSWER_WAIT
      ? { profile: watched, previous: data.profiles.find((p) => p.id === watch.previous && p.id !== watch.id) }
      : undefined;
  const conn = connectionState(saved, running, now, status?.tunnel ?? null);
  const importButton = (
    <ConfigButton
      blank={blank}
      onClick={() => {
        setImporting(true);
      }}
    />
  );

  // the save bar's Save: the active profile is kept in step, in the same apply
  const saveForm = async (values: ClientForm): Promise<void> => {
    const applied = summary(data.exists ? data.form : undefined, values, data);
    const changes = saveWithProfile(values, data, activeProfile);
    renew.current = values.enabled && touchesPeer(changes);
    keep.current = false;
    setWatch(undefined);
    const kept = activeProfile !== undefined && updateChanges(activeProfile, formOf(values)).length > 0;
    await apply(changes, { note: [...applied, ...(kept ? [`${activeProfile.name} is updated too.`] : [])].join(' ') });
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {settingsRead.error !== null && <LoadError error={settingsRead.error} retry={() => void settingsRead.refetch()} />}
        {!data.installed ? (
          <NoWireGuard />
        ) : (
          <>
            <Card className="gap-0 py-0">
              <div className="flex flex-col gap-1.5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                      {blank ? 'No VPN set up yet' : conn.headline}
                    </h2>
                    {/* the heading already says when there's none */}
                    {!blank && (
                      <Badge variant={conn.tone === 'ok' ? 'success' : conn.tone === 'warn' ? 'warning' : 'secondary'}>
                        {conn.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {blank && importButton}
                    <Switch
                      checked={form.enabled}
                      disabled={blank}
                      onCheckedChange={(v) => {
                        set('enabled', v);
                      }}
                      aria-label="VPN on"
                    />
                  </div>
                </div>
                <p className="flex max-w-prose flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {blank
                    ? 'Start with your VPN provider’s WireGuard config file: “Use a config” reads it in, and you can check everything here before saving.'
                    : conn.text}
                  {!blank && conn.peer !== undefined && conn.peer.latest_handshake > 0 && (
                    <Traffic down={conn.peer.rx_bytes} up={conn.peer.tx_bytes} />
                  )}
                </p>
                {!blank && conn.note !== undefined && <p className="max-w-prose text-sm text-muted-foreground">{conn.note}</p>}
              </div>
              {!blank && (
                <div className="grid divide-y border-t md:grid-cols-3 md:divide-x md:divide-y-0">
                  <Cell
                    title="Goes through the tunnel"
                    status={
                      <span className="text-sm font-medium">
                        {saved.enabled ? whoSummary(saved, data) : 'Nothing while it’s off'}
                      </span>
                    }
                  >
                    <p>The rest, and the router’s own traffic, go out directly as before.</p>
                  </Cell>
                  <Cell
                    title="DNS"
                    status={
                      saved.useVpnDns && activeDnsOf(saved).length > 0 ? (
                        <Badge variant="success">VPN’s DNS</Badge>
                      ) : (
                        <Badge variant="secondary">Router’s DNS</Badge>
                      )
                    }
                  >
                    <p>
                      {saved.useVpnDns && activeDnsOf(saved).length > 0
                        ? `Its devices use ${activeDnsOf(saved).join(', ')} through the tunnel; other devices keep this router’s DNS.`
                        : 'All devices keep this router’s DNS.'}
                    </p>
                  </Cell>
                  <Cell
                    title="Kill switch"
                    status={saved.killSwitch ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
                  >
                    <p>
                      {saved.killSwitch
                        ? 'If the tunnel drops, its devices get no internet rather than going out unprotected.'
                        : 'If the tunnel drops, its devices go out directly until it’s back.'}
                    </p>
                  </Cell>
                </div>
              )}
            </Card>
            {fix.length > 0 && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Settings changed outside this page</AlertTitle>
                <AlertDescription>
                  Some of its parts were edited in LuCI or on another page (
                  {[...new Set(fix.map((c) => ('section' in c ? c.section : c.config)))].join(', ')}). Saving here puts them back
                  as this page sets them.
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={working}
                    onClick={() => {
                      keep.current = false;
                      renew.current = false;
                      void apply(fix, { note: 'Put its parts back as this page sets them.' });
                    }}
                  >
                    <Undo2Icon />
                    Put back
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {(data.exists || data.profiles.length > 0) && (
              <ProfilesCard
                data={data}
                dirty={dirty}
                busy={working}
                unanswered={unanswered}
                onApply={applyProfiles}
                onActivate={(p) => {
                  activate(p, true);
                }}
                onGoBack={(p) => {
                  // back to how it was, the VPN off too if it was
                  activate(p, false, watch?.wasOn ?? true);
                }}
                onEditActive={toSettings}
                onSaveAs={() => {
                  setSavingAs(true);
                }}
              />
            )}
            <div className={cn('grid items-start gap-4', !blank && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
              <fieldset
                id={SETTINGS}
                tabIndex={-1}
                disabled={loading}
                className="m-0 flex min-w-0 scroll-mt-4 flex-col gap-4 border-0 p-0 outline-none"
              >
                <ClientFormCards
                  form={form}
                  set={set}
                  errors={errors}
                  data={data}
                  mode="live"
                  importButton={importButton}
                  imported={imported}
                  live={{
                    blank,
                    details: details,
                    onToggleDetails: () => {
                      setDetails((d) => !(d || serverWrong));
                    },
                  }}
                />
              </fieldset>

              <div className="flex flex-col gap-4">
                {!blank && (
                  <Card>
                    <CardHeading title="What this sets up" status={dirty ? 'Once saved.' : 'As saved.'} />
                    <CardContent className="flex flex-col gap-4">
                      <ul className="flex flex-col gap-2">
                        {describe(form, data).map((l) => (
                          <CheckItem key={l.text} yes={l.ok}>
                            {l.text}
                          </CheckItem>
                        ))}
                      </ul>
                      <p className="border-t pt-3 text-xs text-muted-foreground">
                        It’s OpenWrt’s own setup, so LuCI shows each part: Network → Interfaces ({CLIENT}, with the server as its
                        peer, routes in table {CLIENT_TABLE}), Network → Routing (the rules that send marked devices there),
                        Network → Firewall (zone {CLIENT}, the MARK rules, the kill switch’s block)
                        {data.nftset === true && form.direct.length > 0
                          ? ', Network → DHCP and DNS → IP Sets (the sites that go direct)'
                          : ''}
                        {data.sqm ? ' and Network → SQM QoS' : ''}. The{' '}
                        <Link {...pageLink('firewall', 'rules')} className="font-medium link underline-offset-4">
                          Firewall page
                        </Link>{' '}
                        labels its rules.
                      </p>
                    </CardContent>
                  </Card>
                )}
                {data.exists && (
                  <Button
                    variant="ghost"
                    className="self-start text-destructive hover:bg-destructive-subtle hover:text-destructive"
                    disabled={working}
                    onClick={() => {
                      setConfirmRemove(true);
                    }}
                  >
                    <Trash2Icon />
                    Remove the VPN
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={working}
        invalid={invalid}
        onSave={settings.save}
        onRevert={() => {
          discard();
          setImported(undefined);
        }}
        extra={
          activeProfile === undefined && !blank ? (
            <Button
              variant="outline"
              size="sm"
              disabled={working || invalid}
              onClick={() => {
                setSavingAs(true);
              }}
            >
              <BookmarkPlusIcon />
              Save these settings as a profile
            </Button>
          ) : undefined
        }
      />
      {savingAs && (
        <ProfileNameDialog
          title="Save these settings as a profile"
          description={
            dirty
              ? 'Your changes are saved, and kept under a name, like “USA”, as the active profile: you can switch back to them any time.'
              : 'They stay as they are and get a name, like “USA”, as the active profile: you can switch back to them any time.'
          }
          action="Save"
          profiles={data.profiles}
          busy={working}
          onSave={saveAs}
          onClose={() => {
            setSavingAs(false);
          }}
        />
      )}
      <ImportDialog
        open={importing}
        onClose={() => {
          setImporting(false);
        }}
        onUse={useConf}
      />
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the VPN?</DialogTitle>
            <DialogDescription>
              The WireGuard interface and its keys, its routing rules, its firewall zone, marks and kill switch
              {data.sqm ? ', and its Smart Queue' : ''} all go, here and in LuCI, and every device goes out directly. To only
              pause it, turn it off instead.
              {data.form.direct.length > 0 ? ' The list of sites that go direct goes too.' : ''}
              {dirty ? ' Changes you haven’t saved are dropped too.' : ''}
              {data.profiles.length > 0 ? ' Your profiles stay, ready to activate.' : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                discard();
                setWatch(undefined);
                keep.current = false;
                renew.current = false;
                void apply(removal(data), {
                  note: 'Deleted the VPN’s interface and keys, its routing rules, its firewall zone and rules: every device goes out directly.',
                });
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
