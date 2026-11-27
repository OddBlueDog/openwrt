// VPN profiles: named presets ("USA", "France") of the whole client form
// except its on/off switch, kept as milkflint vpn_profile sections, with one
// of them active. The live config (network, firewall, sqm) is the active
// profile, edited on the page; activating another writes its form there in
// one apply, together with the pointer. Saving the page while a profile is
// active writes that profile too, so it never differs from what runs.
import { type Change, list, type Section, str } from '@/lib/api/uci';
import { blankForm, type ClientData, type ClientForm, serverText, toChanges, whoSummary, type Who } from './model';
import { PROFILE_PREFIX, PROFILE_TYPE, PROFILES_POINTER, PROFILES_POINTER_TYPE } from './sections';

export type ProfileForm = Omit<ClientForm, 'enabled'>;
export interface Profile {
  id: string;
  name: string;
  form: ProfileForm;
}

type Values = Record<string, string | string[]>;

const WHO: readonly Who[] = ['all', 'only', 'except', 'none'];
const flag = (b: boolean): string => (b ? '1' : '0');
const isOn = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on', 'enabled'].includes(v);

/** A form without its on/off switch. */
export function formOf(f: ClientForm): ProfileForm {
  const out: Partial<ClientForm> = { ...f };
  delete out.enabled;
  return out as ProfileForm;
}

/** The section's options for a form; an option without a value (uci can't keep an empty one) is left out. */
export function profileToSection(name: string, f: ProfileForm): Values {
  const all: Record<string, string | string[]> = {
    name,
    private_key: f.privateKey,
    addresses: f.addresses.map((a) => a.trim()).filter((a) => a !== ''),
    mtu: f.mtu,
    public_key: f.publicKey,
    preshared_key: f.presharedKey,
    endpoint_host: f.endpointHost.trim(),
    endpoint_port: f.endpointPort,
    keepalive: f.keepalive,
    who: f.who,
    macs: f.macs,
    guests: f.guests,
    kill_switch: flag(f.killSwitch),
    use_vpn_dns: flag(f.useVpnDns),
    dns: f.dns.map((a) => a.trim()).filter((a) => a !== ''),
    shaper: flag(f.shaper),
    down_mbit: f.downMbit,
    up_mbit: f.upMbit,
    direct: f.direct,
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== '' && !(Array.isArray(v) && v.length === 0)));
}

/** A stored section as a profile: options it lacks take a blank form's values, guest networks that are gone are dropped. */
export function sectionToProfile(s: Section, d: Pick<ClientData, 'guestZones' | 'wanRates' | 'sqm'>): Profile {
  const b = formOf(blankForm(d));
  const who = str(s, 'who');
  const known = d.guestZones.map((g) => g.id);
  return {
    id: s['.name'],
    name: str(s, 'name') ?? s['.name'],
    form: {
      privateKey: str(s, 'private_key') ?? b.privateKey,
      addresses: list(s, 'addresses'),
      mtu: str(s, 'mtu') ?? b.mtu,
      publicKey: str(s, 'public_key') ?? b.publicKey,
      presharedKey: str(s, 'preshared_key') ?? b.presharedKey,
      endpointHost: str(s, 'endpoint_host') ?? b.endpointHost,
      endpointPort: str(s, 'endpoint_port') ?? b.endpointPort,
      keepalive: str(s, 'keepalive') ?? b.keepalive,
      who: WHO.find((w) => w === who) ?? b.who,
      macs: list(s, 'macs').map((m) => m.toLowerCase()),
      guests: list(s, 'guests').filter((g): g is ClientForm['guests'][number] => known.some((k) => k === g)),
      killSwitch: isOn(str(s, 'kill_switch'), b.killSwitch),
      useVpnDns: isOn(str(s, 'use_vpn_dns'), b.useVpnDns),
      dns: list(s, 'dns'),
      shaper: isOn(str(s, 'shaper'), b.shaper),
      downMbit: str(s, 'down_mbit') ?? b.downMbit,
      upMbit: str(s, 'up_mbit') ?? b.upMbit,
      direct: list(s, 'direct'),
    },
  };
}

/** Why a name can't be used, or undefined. `self` is the profile being renamed (its own name stays allowed). */
export function nameError(name: string, others: readonly Profile[], self?: string): string | undefined {
  const n = name.trim();
  if (n === '') return 'Give the profile a name.';
  if (n.length > 32) return 'Use 32 characters or fewer.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return 'Use letters, numbers and punctuation only.';
  if (others.some((p) => p.id !== self && p.name.trim().toLowerCase() === n.toLowerCase()))
    return 'Another profile already has this name.';
  return undefined;
}

/**
 * vpnp_<n> with the smallest n that isn't taken. `avoid` is the id the
 * pointer names, which isn't taken by a profile when the pointer is stale: it
 * isn't reused either, or the new profile would silently become the active one.
 */
export function nextProfileId(existing: readonly Profile[], avoid?: string): string {
  const used = new Set(existing.map((p) => p.id));
  if (avoid !== undefined) used.add(avoid);
  let n = 1;
  while (used.has(`${PROFILE_PREFIX}${String(n)}`)) n++;
  return `${PROFILE_PREFIX}${String(n)}`;
}

/** The id the pointer names, whether or not a profile has it. */
export function pointedId(d: Pick<ClientData, 'present'>): string | undefined {
  return str(
    d.present.milkflint.find((s) => s['.name'] === PROFILES_POINTER),
    'active',
  );
}

/** The id a new profile gets. */
export const newProfileId = (d: Pick<ClientData, 'profiles' | 'present'>): string => nextProfileId(d.profiles, pointedId(d));

export function createChanges(name: string, f: ProfileForm, existing: readonly Profile[], avoid?: string): Change[] {
  const id = nextProfileId(existing, avoid);
  return [{ op: 'add', config: 'milkflint', type: PROFILE_TYPE, name: id, values: profileToSection(name.trim(), f) }];
}

export function renameChanges(p: Profile, name: string): Change[] {
  return name.trim() === p.name ? [] : [{ op: 'set', config: 'milkflint', section: p.id, values: { name: name.trim() } }];
}

/** Rewrites the section's form options: only those that differ from what `p` holds; empty ones are unset. */
export function updateChanges(p: Profile, f: ProfileForm): Change[] {
  const before = profileToSection(p.name, p.form);
  const after = profileToSection(p.name, f);
  const same = (a: string | string[] | undefined, b: string | string[]): boolean => JSON.stringify(a) === JSON.stringify(b);
  const set = Object.fromEntries(Object.entries(after).filter(([k, v]) => !same(before[k], v)));
  const unset = Object.keys(before).filter((k) => !(k in after));
  const out: Change[] = [];
  if (Object.keys(set).length > 0) out.push({ op: 'set', config: 'milkflint', section: p.id, values: set });
  if (unset.length > 0) out.push({ op: 'unset', config: 'milkflint', section: p.id, options: unset });
  return out;
}

export function deleteChanges(p: Profile): Change[] {
  return [{ op: 'delete', config: 'milkflint', section: p.id }];
}

/** The pointer set to `id`: added when there's none yet, nothing when it names `id` already. */
export function pointerChanges(id: string, d: Pick<ClientData, 'present'>): Change[] {
  const pointer = d.present.milkflint.find((s) => s['.name'] === PROFILES_POINTER);
  if (pointer === undefined)
    return [{ op: 'add', config: 'milkflint', type: PROFILES_POINTER_TYPE, name: PROFILES_POINTER, values: { active: id } }];
  return str(pointer, 'active') === id
    ? []
    : [{ op: 'set', config: 'milkflint', section: PROFILES_POINTER, values: { active: id } }];
}

/** The profile's form as the live config (switched on, or as `enabled` says), and the pointer to it: one apply. */
export function activateChanges(p: Profile, d: ClientData, enabled = true): Change[] {
  return [...toChanges({ ...p.form, enabled }, d), ...pointerChanges(p.id, d)];
}

/** "New profile" from the settings running now, when none is active: the copy becomes the active one, as Save-as does. */
export function copyLiveChanges(name: string, f: ProfileForm, d: ClientData): Change[] {
  return [
    ...createChanges(name, f, d.profiles, pointedId(d)),
    ...(d.active === undefined ? pointerChanges(newProfileId(d), d) : []),
  ];
}

/**
 * "Save these settings as a profile": a new profile holding `f`, made the
 * active one, since it's what runs. The page's own save of `f`, when it has
 * unsaved changes, goes before these in the same apply.
 */
export function saveAsChanges(name: string, f: ClientForm, d: ClientData): Change[] {
  return [...createChanges(name, formOf(f), d.profiles, pointedId(d)), ...pointerChanges(newProfileId(d), d)];
}

/** The page's save, and the active profile's section kept in step with it. */
export function saveWithProfile(f: ClientForm, d: ClientData, active: Profile | undefined): Change[] {
  const changes: Change[] = toChanges(f, d);
  if (active === undefined) return changes;
  return [...changes, ...updateChanges(active, formOf(f))];
}

/** The devices that matter: only "only" and "except" use the list, the readback leaves it empty otherwise. */
export const macsOf = (f: Pick<ClientForm, 'who' | 'macs'>): string[] =>
  f.who === 'only' || f.who === 'except' ? f.macs.map((m) => m.toLowerCase()) : [];

/** Whether the live form isn't what the profile holds, `enabled` aside, compared as the config reads back. */
export function differs(p: Profile, live: ClientForm, d: Pick<ClientData, 'sqm' | 'nftset'>): boolean {
  return JSON.stringify(canonical(p.form, d)) !== JSON.stringify(canonical(formOf(live), d));
}

/** A form as the page reads it back after a save: what a setting leaves unused isn't there. */
function canonical(f: ProfileForm, d: Pick<ClientData, 'sqm' | 'nftset'>): [string, string | string[]][] {
  // the queue is written only while it's on, and without Smart Queue installed it can't be
  const queue = f.shaper && d.sqm;
  // nor the sites that go direct without a dnsmasq that can fill their sets
  const rate = (v: string): string => (Number.isFinite(Number(v)) && v.trim() !== '' ? String(Number(v)) : v.trim());
  const s = profileToSection('', {
    ...f,
    macs: macsOf(f),
    shaper: queue,
    downMbit: queue ? rate(f.downMbit) : '',
    upMbit: queue ? rate(f.upMbit) : '',
    direct: d.nftset === true ? f.direct : [],
  });
  for (const k of ['macs', 'guests', 'direct']) {
    const v = s[k];
    if (Array.isArray(v)) s[k] = [...v].sort();
  }
  if (typeof s['private_key'] === 'string') s['private_key'] = s['private_key'].trim();
  return Object.entries(s).sort(([a], [b]) => a.localeCompare(b));
}

/** Whether a profile has no server yet: no keys, or nowhere to connect to (a blank one). */
export function needsServer(p: Profile): boolean {
  return p.form.privateKey === '' || p.form.publicKey === '' || p.form.endpointHost.trim() === '';
}

/** "vpn.example.com:51820 · Every home device · Kill switch on", or "Needs a server". */
export function profileSummary(p: Profile, d: Pick<ClientData, 'guestZones'>): string {
  if (needsServer(p)) return 'Needs a server';
  const f: ClientForm = { ...p.form, enabled: true };
  return [serverText(f), whoSummary(f, d), f.killSwitch ? 'Kill switch on' : 'Kill switch off'].join(' · ');
}
