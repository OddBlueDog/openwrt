// banIP's options as the page sets them: the router's spec
// (source/feed/milkflint-ui/files/features/banip/bin/banip-options.json,
// which milkflint.banip checks every value against) mirrored here for the
// page's own checks, then each option's words for the Advanced sheet.
// tests/banip-model.test.ts checks the two specs agree.

export type OptionType = 'bool' | 'int' | 'enum' | 'string' | 'path' | 'list';
export type Apply = 'own' | 'restart' | 'none';
export type ItemKind = 'device' | 'interface' | 'feed' | 'country' | 'region' | 'asn' | 'url' | 'logterm';

export interface OptionSpec {
  type: OptionType;
  /** what banIP uses while it's unset */
  default?: string;
  min?: number;
  max?: number;
  values?: readonly string[];
  pattern?: string;
  item?: ItemKind;
  check?: 'ports' | 'address';
  apply: Apply;
  /** a list whose contents this changes: its backup goes, so a restart fetches it again */
  refetch?: 'allowlist' | 'country' | 'asn';
}

const b = (d: string, apply: Apply = 'restart'): OptionSpec => ({ type: 'bool', default: d, apply });
const n = (min: number, max: number, d?: string): OptionSpec => ({ type: 'int', min, max, apply: 'restart', ...(d === undefined ? {} : { default: d }) });
const list = (item: ItemKind, refetch?: OptionSpec['refetch']): OptionSpec => ({ type: 'list', item, apply: 'restart', ...(refetch === undefined ? {} : { refetch }) });
const path = (d?: string): OptionSpec => ({ type: 'path', apply: 'restart', ...(d === undefined ? {} : { default: d }) });

export const OPTIONS = {
  ban_enabled: { type: 'bool', default: '0', apply: 'own' },
  ban_debug: b('0'),
  ban_autodetect: b('1'),
  ban_protov4: b('0'),
  ban_protov6: b('0'),
  ban_dev: list('device'),
  ban_ifv4: list('interface'),
  ban_ifv6: list('interface'),
  ban_fetchcmd: { type: 'enum', values: ['uclient-fetch', 'wget', 'curl'], apply: 'restart' },
  ban_fetchparm: { type: 'string', pattern: '^[A-Za-z0-9 =:,./_-]{1,200}$', apply: 'restart' },
  ban_trigger: list('interface'),
  ban_triggerdelay: n(1, 300, '20'),
  ban_fetchretry: n(1, 99, '5'),
  ban_fetchinsecure: b('0'),
  ban_nftcount: b('0'),
  ban_nicelimit: n(-20, 19, '0'),
  ban_filelimit: n(64, 65536, '1024'),
  ban_cores: n(1, 64),
  ban_splitsize: n(0, 10000000, '0'),
  ban_basedir: path('/tmp'),
  ban_backupdir: path('/tmp/banIP-backup'),
  ban_reportdir: path('/tmp/banIP-report'),
  ban_errordir: path('/tmp/banIP-error'),
  ban_deduplicate: b('1'),
  ban_nftpriority: n(-300, 300, '-100'),
  ban_allowflag: {
    type: 'string',
    pattern: '^(tcp|udp|[0-9]{1,5}(-[0-9]{1,5})?)( (tcp|udp|[0-9]{1,5}(-[0-9]{1,5})?))*$',
    check: 'ports',
    apply: 'restart',
  },
  ban_vlanallow: list('device'),
  ban_vlanblock: list('device'),
  ban_bcp38: b('0'),
  ban_icmplimit: n(0, 1000000, '25'),
  ban_synlimit: n(0, 1000000, '10'),
  ban_udplimit: n(0, 1000000, '100'),
  ban_nftpolicy: { type: 'enum', default: 'memory', values: ['memory', 'performance'], apply: 'restart' },
  ban_nftretry: n(1, 10, '3'),
  ban_blockpolicy: { type: 'enum', default: 'drop', values: ['drop', 'reject'], apply: 'restart' },
  ban_feedin: list('feed'),
  ban_feedout: list('feed'),
  ban_feedinout: list('feed'),
  ban_feedreset: list('feed'),
  ban_feedcomplete: list('feed'),
  ban_nftloglevel: { type: 'enum', default: 'warn', values: ['emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug'], apply: 'restart' },
  ban_logprerouting: b('0'),
  ban_loginbound: b('0'),
  ban_logoutbound: b('0'),
  ban_logreadfile: path(),
  ban_loglimit: n(0, 100000, '100'),
  ban_logcount: n(1, 100, '1'),
  ban_logratelimit: n(0, 10000, '10'),
  ban_logburstlimit: n(1, 10000, '5'),
  ban_logterm: list('logterm'),
  ban_remotelog: b('0', 'none'),
  ban_remotetoken: { type: 'string', pattern: '^[A-Za-z0-9.:]{3,20}$', apply: 'none' },
  ban_nftexpiry: { type: 'string', pattern: '^([1-9][0-9]{0,6}(ms|s|m|h|d)){1,4}$', apply: 'restart' },
  ban_autoallowlist: b('1'),
  ban_autoallowuplink: { type: 'enum', default: 'subnet', values: ['disable', 'subnet', 'ip'], apply: 'restart' },
  ban_autoblocklist: b('1'),
  ban_autoblocksubnet: b('0'),
  ban_allowlistonly: b('0'),
  ban_monitorallowed: b('0'),
  ban_allowurl: list('url', 'allowlist'),
  ban_feed: list('feed'),
  ban_country: list('country', 'country'),
  ban_region: list('region', 'country'),
  ban_countrysplit: { type: 'bool', default: '0', apply: 'restart', refetch: 'country' },
  ban_asn: list('asn', 'asn'),
  ban_asnsplit: { type: 'bool', default: '0', apply: 'restart', refetch: 'asn' },
  ban_resolver: { type: 'string', pattern: '^[0-9A-Fa-f:.]{2,45}$', check: 'address', apply: 'restart' },
  ban_mailnotification: b('0', 'none'),
  ban_mailreceiver: { type: 'string', pattern: '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\\.[A-Za-z]{2,24}$', apply: 'none' },
  ban_mailsender: { type: 'string', default: 'no-reply@banIP', pattern: '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}$', apply: 'none' },
  ban_mailtopic: { type: 'string', default: 'banIP notification', pattern: '^[ -~]{1,100}$', apply: 'none' },
  ban_mailprofile: { type: 'string', default: 'ban_notify', pattern: '^[A-Za-z0-9_]{1,32}$', apply: 'none' },
} as const satisfies Record<string, OptionSpec>;

export type OptionName = keyof typeof OPTIONS;
export const OPTION_NAMES = Object.keys(OPTIONS) as OptionName[];

export const ITEMS: Record<ItemKind, string> = {
  device: '^[A-Za-z0-9._@:-]{1,15}$',
  interface: '^[A-Za-z0-9_]{1,15}$',
  feed: '^[a-z0-9]{3,15}$|^allowlist$|^blocklist$',
  country: '^[a-z]{2}$',
  region: '^(AFRINIC|APNIC|ARIN|LACNIC|RIPE)$',
  asn: '^[1-9][0-9]{0,9}$',
  url: '^https?://[A-Za-z0-9-]+\\.[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._?&+=:~#%/-]*)?$',
  logterm: '^[^\\x01-\\x1f\\x7f]{1,200}$',
};

/** MilkFlint's own banIP settings (milkflint.banip) */
export const MILKFLINT = {
  schedule: { type: 'enum', default: 'daily', values: ['off', '6h', '12h', 'daily', 'weekly'] },
  time: { type: 'string', default: '04:00', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  day: { type: 'int', default: '0', min: 0, max: 6 },
  preset: { type: 'enum', default: 'off', values: ['off', 'recommended', 'strict', 'custom'] },
} as const;

/** An option's value as the page holds it: a string, a list, or null (unset: banIP's default). */
export type OptionValue = string | readonly string[] | null;
export type Options = Partial<Record<OptionName, OptionValue>>;

function portsOk(v: string): boolean {
  for (const t of v.split(' ')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(t);
    if (m === null) continue;
    const a = Number(m[1]);
    const z = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || a > 65535 || z < a || z > 65535) return false;
  }
  return true;
}

function regexOk(term: string): boolean {
  const t = term.replace(/^(first|last):/, '');
  if (t === '') return false;
  try {
    new RegExp(t);
    return true;
  } catch {
    return false;
  }
}

function addressOk(v: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? v.split('.').every((o) => Number(o) <= 255) : /^[0-9a-f:]+$/i.test(v) && v.includes(':');
}

/**
 * What's wrong with an option's value, as the router would say it (null:
 * fine), or the reason code milkflint.banip uses. `feeds`: the catalogue's
 * names; `countries`: banIP's country codes.
 */
export function checkValue(name: OptionName, value: OptionValue, ctx?: { feeds?: ReadonlySet<string>; countries?: ReadonlySet<string> }): string | null {
  const o: OptionSpec = OPTIONS[name];
  if (value === null) return null;
  if (o.type === 'list') {
    if (typeof value === 'string') return 'type';
    if (value.length > 1000) return 'too_many';
    const re = o.item === undefined ? null : new RegExp(ITEMS[o.item]);
    const seen = new Set<string>();
    for (const v of value) {
      if (re?.test(v) !== true) return 'item';
      if (seen.has(v)) return 'duplicate';
      seen.add(v);
      if (o.item === 'feed' && ctx?.feeds !== undefined && v !== 'allowlist' && v !== 'blocklist' && !ctx.feeds.has(v)) return 'feed';
      if (o.item === 'country' && ctx?.countries !== undefined && !ctx.countries.has(v)) return 'country';
      if (o.item === 'asn' && Number(v) > 4294967295) return 'item';
      if (o.item === 'logterm' && !regexOk(v)) return 'regex';
    }
    return null;
  }
  if (typeof value !== 'string') return 'type';
  switch (o.type) {
    case 'bool':
      return value === '0' || value === '1' ? null : 'bool';
    case 'int': {
      if (!/^-?\d{1,9}$/.test(value)) return 'range';
      const v = Number(value);
      return v >= (o.min ?? -2147483648) && v <= (o.max ?? 2147483647) ? null : 'range';
    }
    case 'enum':
      return (o.values ?? []).includes(value) ? null : 'value';
    case 'path':
      return /^\/[A-Za-z0-9._/-]{1,120}$/.test(value) && !value.includes('..') ? null : 'path';
    case 'string':
      if (o.pattern === undefined || !new RegExp(o.pattern).test(value)) return 'format';
      if (o.check === 'ports' && !portsOk(value)) return 'range';
      if (o.check === 'address' && !addressOk(value)) return 'format';
      return null;
  }
}

/** The value banIP works with: what's set, else its default. */
export function effective(options: Options, name: OptionName): string | readonly string[] {
  const v = options[name];
  const o: OptionSpec = OPTIONS[name];
  if (v === null || v === undefined) return o.type === 'list' ? [] : (o.default ?? '');
  return v;
}

export function isOn(options: Options, name: OptionName): boolean {
  return effective(options, name) === '1';
}

const same = (a: OptionValue | undefined, z: OptionValue | undefined): boolean => {
  const norm = (v: OptionValue | undefined): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : v.length === 0 ? '' : JSON.stringify(v));
  return norm(a) === norm(z);
};

/**
 * Only what changed, for milkflint.banip set: a value that differs from
 * what's saved, or null to unset one that's set (back to banIP's default).
 * An empty list unsets.
 */
export function optionChanges(saved: Options, draft: Options): Options {
  const out: Options = {};
  for (const name of OPTION_NAMES) {
    if (!(name in draft)) continue;
    const before = saved[name] ?? null;
    const after = draft[name] ?? null;
    if (same(before, after)) continue;
    out[name] = after === null || (typeof after !== 'string' && after.length === 0) ? null : after;
  }
  return out;
}

/** Whether a change makes banIP restart (its table is rebuilt). */
export function needsRestart(changes: Options): boolean {
  return Object.keys(changes).some((k) => (OPTIONS[k as OptionName] as OptionSpec).apply === 'restart');
}
