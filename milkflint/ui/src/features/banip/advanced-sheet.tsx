// The banIP page's Advanced sheet: every option of banIP's the page doesn't
// show elsewhere, as luci-app-banip has them, by what they're for: General
// (finding the internet connection, starting), Firewall (banIP's chains,
// what it does with a blocked packet, the flood limits), Logging (what's
// logged, counting, the log monitor), Downloads (how and where it fetches,
// your own lists' file), Email. Each says what it does and its default,
// with a reset; a save writes only what changed.
import {
  CableIcon,
  DownloadIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MailIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  ShieldIcon,
  UploadIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type ChangeEvent, type ReactElement, type ReactNode, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { cn, errorMessage } from '@/lib/utils';
import { Opt } from '../firewall/sheet-parts';
import {
  type BanipConfig,
  customFile,
  importFeeds,
  installPackage,
  type MailAccount,
  type MailSettings,
  saveMail,
  testMail,
} from './api';
import { banipQueries, useBanipWrite } from './queries';
import {
  checkValue,
  effective,
  type OptionName,
  type Options,
  OPTIONS,
  type OptionSpec,
  optionChanges,
  type OptionValue,
} from './options';

type TabId = 'general' | 'firewall' | 'logging' | 'downloads' | 'email';
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: CableIcon },
  { id: 'firewall', label: 'Firewall', icon: ShieldIcon },
  { id: 'logging', label: 'Logging', icon: ScrollTextIcon },
  { id: 'downloads', label: 'Downloads', icon: DownloadIcon },
  { id: 'email', label: 'Email', icon: MailIcon },
];

interface Def {
  name: OptionName;
  label: string;
  hint: string;
  choices?: readonly { value: string; label: string }[];
  unit?: string;
  /** shown only when this holds */
  when?: (o: Options) => boolean;
  /** what banIP runs with now, from its runtime information */
  now?: (c: BanipConfig) => string | undefined;
  placeholder?: string;
}

const autoOff = (o: Options): boolean => effective(o, 'ban_autodetect') === '0';
const nft = (k: string) => (c: BanipConfig) => c.runtime?.nft[k] ?? undefined;

const FIELDS: Record<TabId, readonly { title: string; fields: readonly Def[] }[]> = {
  general: [
    {
      title: 'The internet connection',
      fields: [
        {
          name: 'ban_autodetect',
          label: 'Find it by itself',
          hint: 'banIP finds the interfaces with the default route, their devices and addresses at each start. On by default.',
        },
        { name: 'ban_protov4', label: 'IPv4', hint: 'Block over IPv4.', when: autoOff },
        { name: 'ban_protov6', label: 'IPv6', hint: 'Block over IPv6.', when: autoOff },
        {
          name: 'ban_ifv4',
          label: 'IPv4 interfaces',
          hint: 'The network interfaces of the internet connection, e.g. wan.',
          when: autoOff,
          now: (c) => c.runtime?.interfaces.join(' '),
        },
        { name: 'ban_ifv6', label: 'IPv6 interfaces', hint: 'e.g. wan6.', when: autoOff },
        {
          name: 'ban_dev',
          label: 'Devices',
          hint: 'The ports or tunnels traffic to the internet goes through, e.g. eth1 or pppoe-wan. To filter devices sent through a VPN too, add its tunnel.',
          when: autoOff,
          now: (c) => c.runtime?.devices.join(' '),
        },
      ],
    },
    {
      title: 'Starting',
      fields: [
        {
          name: 'ban_trigger',
          label: 'Start when these come up',
          hint: 'banIP starts (or refreshes its own addresses) when these interfaces come up. MilkFlint sets the internet zone’s.',
          now: (c) => c.runtime?.triggers.join(' '),
        },
        {
          name: 'ban_triggerdelay',
          label: 'Wait before starting',
          hint: 'At boot and after an interface event. 20 s by default.',
          unit: 's',
        },
      ],
    },
  ],
  firewall: [
    {
      title: 'Blocked packets',
      fields: [
        {
          name: 'ban_blockpolicy',
          label: 'Coming in',
          hint: 'Drop says nothing back (banIP’s default, and what the router’s stealth mode expects). Reject answers, which tells a scanner something is there. Your devices’ blocked connections are always refused at once.',
          choices: [
            { value: 'drop', label: 'Drop silently' },
            { value: 'reject', label: 'Reject' },
          ],
        },
        {
          name: 'ban_nftpriority',
          label: 'Chain priority',
          hint: 'Where banIP’s chains run among the firewall’s: lower runs earlier. -100 by default, before the firewall’s own (0).',
          now: nft('priority'),
        },
        {
          name: 'ban_allowflag',
          label: 'Always let through',
          hint: 'Protocols and ports coming in that no list blocks, e.g. “tcp 22 443”. MilkFlint adds Remote access’s WireGuard port itself.',
          placeholder: 'tcp udp 443',
        },
        {
          name: 'ban_vlanallow',
          label: 'Allow these networks out',
          hint: 'Bridge or VLAN devices whose traffic out no list blocks, e.g. br-lan.20.',
        },
        {
          name: 'ban_vlanblock',
          label: 'Block these networks out',
          hint: 'Devices whose traffic to the internet is always refused.',
        },
        {
          name: 'ban_bcp38',
          label: 'Drop spoofed sources (BCP38)',
          hint: 'Drops packets whose source address can’t come from where they arrived. Off by default.',
        },
      ],
    },
    {
      title: 'Flood limits',
      fields: [
        {
          name: 'ban_icmplimit',
          label: 'ICMP',
          hint: 'Packets a second from the internet, all together; 0 is off. Off here: one allowance for the whole internet, so a flood would also drop your own ping replies and IPv6’s neighbour messages. banIP’s default is 25.',
          unit: '/s',
        },
        {
          name: 'ban_synlimit',
          label: 'New TCP connections',
          hint: 'Off here: the firewall already limits them for each address (one allowance for all would let a flood shut out the rest). banIP’s default is 10.',
          unit: '/s',
        },
        {
          name: 'ban_udplimit',
          label: 'New UDP flows',
          hint: 'Off here: it would count Remote access, games and peer-to-peer traffic too. banIP’s default is 100.',
          unit: '/s',
        },
      ],
    },
    {
      title: 'Sets',
      fields: [
        {
          name: 'ban_nftpolicy',
          label: 'Set layout',
          hint: 'Memory (banIP’s default) or speed. The lists are only checked for new connections.',
          choices: [
            { value: 'memory', label: 'Less memory' },
            { value: 'performance', label: 'Faster lookups' },
          ],
          now: nft('policy'),
        },
        {
          name: 'ban_splitsize',
          label: 'Load in parts of',
          hint: 'Entries at a time (512 at least, 0 for all at once): less memory while a big list loads, more time.',
          unit: 'entries',
        },
        {
          name: 'ban_nftretry',
          label: 'Load attempts',
          hint: 'Tries to load a list into the firewall before giving up on it. 3 by default.',
        },
        {
          name: 'ban_cores',
          label: 'Lists at once',
          hint: 'How many lists banIP fetches and loads at the same time. By default one a CPU core, fewer when memory is short.',
        },
      ],
    },
  ],
  logging: [
    {
      title: 'Counting and logging',
      fields: [
        {
          name: 'ban_nftcount',
          label: 'Count hits',
          hint: 'Each rule and each entry counts what it blocked: the Activity numbers and the drops over time. Costs a little memory an entry (in the estimate). On here; banIP’s default is off.',
        },
        {
          name: 'ban_logprerouting',
          label: 'Log what the flood limits drop',
          hint: 'Each packet dropped before the lists, in the system log.',
        },
        {
          name: 'ban_nftloglevel',
          label: 'Log level',
          hint: 'The system log level of banIP’s firewall lines. Warn by default.',
          choices: ['emerg', 'alert', 'crit', 'err', 'warn', 'notice', 'info', 'debug'].map((v) => ({ value: v, label: v })),
        },
        {
          name: 'ban_logratelimit',
          label: 'Lines a second',
          hint: 'At most this many firewall lines a second, for all of banIP’s rules together (0: no limit). 10 by default.',
        },
        { name: 'ban_logburstlimit', label: 'Burst', hint: 'Lines let through at once above that. 5 by default.' },
        { name: 'ban_debug', label: 'Debug log', hint: 'banIP says much more in its log, for chasing a problem.' },
      ],
    },
    {
      title: 'The log monitor',
      fields: [
        {
          name: 'ban_loglimit',
          label: 'Log lines in mails',
          hint: 'banIP watches the system log for failed sign-ins and blocks their source; 0 turns that off. Otherwise, the lines of its log a mail includes.',
        },
        {
          name: 'ban_logcount',
          label: 'Failures before a block',
          hint: 'Times the same address must fail before it’s blocked. 1 by default.',
        },
        {
          name: 'ban_nftexpiry',
          label: 'Forget them after',
          hint: 'e.g. 2h, 1d or 1h30m: blocked addresses expire (and aren’t written to the blocklist). Empty: kept for good.',
          placeholder: 'kept for good',
        },
        {
          name: 'ban_autoblocklist',
          label: 'Write them to the blocklist',
          hint: 'Without an expiry, each one goes into the blocklist file too.',
        },
        {
          name: 'ban_autoblocksubnet',
          label: 'Block their whole network',
          hint: 'Asks the address’s registry (RDAP) for its network and blocks that. Off by default.',
        },
        {
          name: 'ban_logreadfile',
          label: 'Read this file instead',
          hint: 'A log file to watch rather than the system log (syslog-ng and the like).',
          placeholder: '/var/log/messages',
        },
        {
          name: 'ban_remotelog',
          label: 'Take reports from other devices',
          hint: 'Other devices at home can report an address to block through banIP’s page at /cgi-bin/banip, with the token below.',
        },
        {
          name: 'ban_remotetoken',
          label: 'Token',
          hint: '3 to 20 letters, digits, dots or colons: a request carries it as <token>=<address>.',
          when: (o) => effective(o, 'ban_remotelog') === '1',
        },
      ],
    },
  ],
  downloads: [
    {
      title: 'Fetching',
      fields: [
        {
          name: 'ban_fetchcmd',
          label: 'Download with',
          hint: 'uclient-fetch is in the firmware. curl and wget download only lists that changed (ETag) and try again on errors, once installed.',
          choices: [
            { value: 'uclient-fetch', label: 'uclient-fetch' },
            { value: 'curl', label: 'curl' },
            { value: 'wget', label: 'wget' },
          ],
          now: (c) => c.runtime?.system.fetch ?? undefined,
        },
        {
          name: 'ban_fetchparm',
          label: 'Its options',
          hint: 'Instead of banIP’s own for that tool; the output option (-o or -O) last.',
        },
        {
          name: 'ban_fetchretry',
          label: 'Attempts',
          hint: 'Downloads tried before a list counts as failed (not with uclient-fetch). 5 by default.',
        },
        {
          name: 'ban_fetchinsecure',
          label: 'Skip certificate checks',
          hint: 'Don’t check the lists’ servers are who they say: anyone between could change the lists. Off by default.',
        },
        {
          name: 'ban_resolver',
          label: 'DNS server for names',
          hint: 'For the domain names in your lists. The router’s own DNS by default.',
          placeholder: 'the router’s',
        },
      ],
    },
    {
      title: 'Processing',
      fields: [
        {
          name: 'ban_deduplicate',
          label: 'Remove duplicates',
          hint: 'An address in two lists is kept in the first only: less memory. On by default.',
        },
        {
          name: 'ban_nicelimit',
          label: 'CPU priority',
          hint: 'From -20 (first) to 19 (last); 0 by default. Higher keeps banIP’s updates further out of the way.',
        },
        {
          name: 'ban_filelimit',
          label: 'Open files',
          hint: 'banIP’s limit; raise it for many lists loaded in parts. 1024 by default.',
        },
        { name: 'ban_basedir', label: 'Working directory', hint: 'In memory (/tmp) by default.' },
        {
          name: 'ban_backupdir',
          label: 'Backups',
          hint: 'The last copy of each list, used when a download fails. /tmp/banIP-backup by default (in memory: gone at a restart).',
        },
        { name: 'ban_reportdir', label: 'Reports', hint: '/tmp/banIP-report by default.' },
        { name: 'ban_errordir', label: 'Errors', hint: 'What banIP couldn’t load, for a look. /tmp/banIP-error by default.' },
      ],
    },
  ],
  email: [
    {
      title: 'Mails',
      fields: [
        { name: 'ban_mailnotification', label: 'Mail after every update', hint: 'Its status, report and log.' },
        { name: 'ban_mailreceiver', label: 'To', hint: 'The address mails go to.', placeholder: 'you@example.com' },
        { name: 'ban_mailsender', label: 'From', hint: 'no-reply@banIP by default.' },
        { name: 'ban_mailtopic', label: 'Subject', hint: '“banIP notification” by default.' },
        {
          name: 'ban_mailprofile',
          label: 'msmtp account',
          hint: 'The account in msmtp’s settings: ban_notify by default (the one below).',
        },
      ],
    },
  ],
};

const DEFAULT = '__default';

/** A list as words: typed freely, kept as the words it holds. */
function ListInput({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: readonly string[];
  invalid: boolean;
  onChange: (v: string[]) => void;
}): ReactElement {
  const [text, setText] = useState(value.join(' '));
  return (
    <Input
      id={id}
      value={text}
      spellCheck={false}
      className="font-mono text-xs"
      placeholder="none"
      aria-invalid={invalid}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(/[\s,]+/).filter((w) => w !== ''));
      }}
    />
  );
}

function Row({
  def,
  o,
  saved,
  c,
  set,
  error,
}: {
  def: Def;
  o: Options;
  saved: Options;
  c: BanipConfig;
  set: (n: OptionName, v: OptionValue) => void;
  error: string | undefined;
}): ReactElement | null {
  const id = useId();
  if (def.when !== undefined && !def.when(o)) return null;
  const spec: OptionSpec = OPTIONS[def.name];
  const value = o[def.name] ?? null;
  const shown = effective(o, def.name);
  const changed = JSON.stringify(value ?? null) !== JSON.stringify(saved[def.name] ?? null);
  const now = def.now?.(c);
  const reset =
    value !== null && !(typeof value !== 'string' && value.length === 0) ? (
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs text-muted-foreground"
        onClick={() => {
          set(def.name, null);
        }}
      >
        <RotateCcwIcon className="size-3" /> Default
      </Button>
    ) : null;
  let control: ReactNode;
  if (spec.type === 'bool') {
    control = (
      <Switch
        id={id}
        checked={shown === '1'}
        onCheckedChange={(v) => {
          set(def.name, v ? '1' : '0');
        }}
      />
    );
  } else if (def.choices !== undefined) {
    control = (
      <Select
        value={value === null ? DEFAULT : (value as string)}
        onValueChange={(v) => {
          set(def.name, v === DEFAULT ? null : v);
        }}
      >
        <SelectTrigger id={id} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>
            Default
            {spec.default !== undefined ? ` (${def.choices.find((x) => x.value === spec.default)?.label ?? spec.default})` : ''}
          </SelectItem>
          {def.choices.map((x) => (
            <SelectItem key={x.value} value={x.value}>
              {x.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (spec.type === 'list') {
    control = (
      <ListInput
        id={id}
        value={typeof shown === 'string' ? [] : shown}
        invalid={error !== undefined}
        onChange={(words) => {
          set(def.name, words);
        }}
      />
    );
  } else {
    control = (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={def.placeholder ?? spec.default ?? ''}
          spellCheck={false}
          inputMode={spec.type === 'int' ? 'numeric' : undefined}
          className={cn(spec.type === 'int' ? 'w-32' : 'w-full', spec.type !== 'int' && 'font-mono text-xs')}
          aria-invalid={error !== undefined}
          onChange={(e) => {
            set(def.name, e.target.value === '' ? null : e.target.value);
          }}
        />
        {def.unit !== undefined && <span className="text-xs text-muted-foreground">{def.unit}</span>}
      </div>
    );
  }
  return (
    <div className={cn('grid gap-1.5', spec.type === 'bool' && 'grid-cols-[1fr_auto] items-start gap-x-3')}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
        <label htmlFor={id}>{def.label}</label>
        <Opt>{def.name}</Opt>
        {changed && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            changed
          </span>
        )}
        {reset}
      </div>
      {spec.type === 'bool' ? <div className="row-span-2 pt-0.5">{control}</div> : control}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      <p className={cn('text-xs text-muted-foreground', spec.type === 'bool' && 'col-start-1')}>
        {def.hint}
        {now !== undefined && now !== '' && (
          <span>
            {' '}
            Now: <span className="font-mono">{now}</span>.
          </span>
        )}
      </p>
    </div>
  );
}

const ERR: Record<string, string> = {
  range: 'Out of range.',
  format: 'Not in the right form.',
  value: 'Not one of the choices.',
  item: 'An entry isn’t in the right form.',
  feed: 'A list that isn’t in the catalogue.',
  duplicate: 'An entry is there twice.',
  regex: 'Not a valid pattern.',
  path: 'A full path, from /.',
  bool: 'On or off.',
};

function LogTerms({ o, set }: { o: Options; set: (n: OptionName, v: OptionValue) => void }): ReactElement {
  const terms = effective(o, 'ban_logterm') as readonly string[];
  const [t, setT] = useState('');
  const presets = [
    { value: 'Exit before auth from', label: 'SSH (dropbear)' },
    { value: 'luci: failed login', label: 'LuCI' },
    { value: 'error: maximum authentication attempts exceeded', label: 'SSH (OpenSSH)' },
    { value: 'sshd.*Connection closed by.*\\[preauth\\]', label: 'SSH closed (OpenSSH)' },
    { value: 'SecurityEvent=\\"InvalidAccountID\\".*RemoteAddress=', label: 'Asterisk' },
    { value: 'TLS Error: could not determine wrapping from \\[AF_INET\\]', label: 'OpenVPN' },
    { value: 'AdGuardHome.*\\[error\\].*/control/login: from ip', label: 'AdGuard Home' },
    { value: 'received a suspicious remote IP', label: 'Reports from other devices' },
  ];
  const err = checkValue('ban_logterm', [...terms, ...(t === '' ? [] : [t])]);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>What a failed sign-in looks like</span>
        <Opt>ban_logterm</Opt>
      </div>
      <ul className="flex flex-col gap-1">
        {terms.map((x) => (
          <li key={x} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{x}</span>
            <span className="text-xs text-muted-foreground">{presets.find((p) => p.value === x)?.label}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                set(
                  'ban_logterm',
                  terms.filter((y) => y !== x),
                );
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1">
        {presets
          .filter((p) => !terms.includes(p.value))
          .map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                set('ban_logterm', [...terms, p.value]);
              }}
            >
              + {p.label}
            </Button>
          ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (t !== '' && err === null) {
            set('ban_logterm', [...terms, t]);
            setT('');
          }
        }}
      >
        <Input
          aria-label="A pattern of your own"
          value={t}
          placeholder="A pattern of your own"
          className="font-mono text-xs"
          onChange={(e) => {
            setT(e.target.value);
          }}
        />
        <Button type="submit" variant="outline" disabled={t === '' || err !== null}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Patterns (regular expressions) for log lines; banIP takes the last address in the line, or the first with “first:” in
        front (web server logs).
      </p>
    </div>
  );
}

function CustomFile({ c, onChanged }: { c: BanipConfig; onChanged: () => void }): ReactElement {
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  // banIP's reads are asked again once a write went through
  const write = useBanipWrite();
  const file = useRef<HTMLInputElement>(null);
  const own = (c.catalogue ?? []).filter((f) => f.own);
  const run = (what: string, fn: () => Promise<unknown>, done: string): void => {
    setBusy(what);
    setNote(undefined);
    write.mutateAsync(fn).then(
      () => {
        setBusy(undefined);
        setNote(done);
        onChanged();
      },
      (err: unknown) => {
        setBusy(undefined);
        setNote(errorMessage(err));
      },
    );
  };
  const exportOwn = (): void => {
    const o: Record<string, unknown> = {};
    for (const f of own)
      o[f.name] = {
        url_4: f.url_4 ?? undefined,
        url_6: f.url_6 ?? undefined,
        rule: f.rule,
        chain: f.chain,
        descr: f.descr,
        flag: f.flag ?? undefined,
      };
    const url = URL.createObjectURL(new Blob([JSON.stringify(o, null, '\t')], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banip.custom.feeds.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Your own lists’ file</h3>
      <p className="text-xs text-muted-foreground">
        banIP reads /etc/banip/banip.custom.feeds instead of its own catalogue when it isn’t empty. MilkFlint keeps it as banIP’s
        catalogue with your lists added, and again after an upgrade brings a new catalogue.{' '}
        {c.custom?.state === 'edited'
          ? 'It was changed outside this page (by hand or LuCI): take it over to edit your lists here, or go back to banIP’s.'
          : own.length === 0
            ? 'You have no lists of your own now.'
            : `Yours: ${own.map((f) => f.name).join(', ')}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {c.custom?.state === 'edited' && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() => {
              run('adopt', () => customFile('adopt'), 'Taken over: its lists that differ from banIP’s are yours now.');
            }}
          >
            {busy === 'adopt' && <LoaderCircleIcon className="animate-spin" />}
            Take it over
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={own.length === 0} onClick={exportOwn}>
          <DownloadIcon /> Export your lists
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== undefined || c.custom?.state === 'edited'}
          onClick={() => file.current?.click()}
        >
          <UploadIcon /> Import lists
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f !== undefined)
              void f.text().then((x) => {
                run('import', () => importFeeds(x), 'Imported.');
              });
            e.target.value = '';
          }}
        />
        {(own.length > 0 || c.custom?.state === 'edited') && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy !== undefined}
            onClick={() => {
              run('reset', () => customFile('reset'), 'Back to banIP’s own catalogue.');
            }}
          >
            Back to banIP’s catalogue
          </Button>
        )}
      </div>
      {note !== undefined && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

function MailAccountForm({ c, onChanged }: { c: BanipConfig; onChanged: () => void }): ReactElement {
  const [f, setF] = useState<MailSettings>({ host: '', port: 587, tls: 'starttls', user: '', password: '', from: '' });
  const [busy, setBusy] = useState<string>();
  const [note, setNote] = useState<string>();
  // banIP's reads are asked again once a write went through
  const write = useBanipWrite();
  const installed = c.tools?.msmtp === true;
  const install = c.install;
  // the account as saved (read once msmtp is there): the form starts from the first read
  const m = useQuery({ ...banipQueries.mail(), enabled: installed }).data;
  const [base, setBase] = useState<MailAccount>();
  if (m !== undefined && base === undefined) {
    setBase(m);
    setF({
      host: m.host ?? '',
      port: m.port ?? 587,
      tls: m.tls ?? 'starttls',
      user: m.user ?? '',
      password: '',
      from: m.from ?? '',
    });
  }
  const run = (what: string, fn: () => Promise<unknown>, done: string): void => {
    setBusy(what);
    setNote(undefined);
    write.mutateAsync(fn).then(
      () => {
        setBusy(undefined);
        setNote(done);
        onChanged();
      },
      (err: unknown) => {
        setBusy(undefined);
        setNote(errorMessage(err));
      },
    );
  };
  if (!installed) {
    return (
      <section className="flex flex-col gap-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Sending them</h3>
        <p className="text-xs text-muted-foreground">
          banIP sends mail with msmtp, which isn’t in the firmware. It’s a small package from OpenWrt’s feed (the router needs the
          internet).
        </p>
        {install?.package === 'msmtp' && install.busy ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Installing msmtp…
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={busy !== undefined}
            onClick={() => {
              run('install', () => installPackage('msmtp'), 'Installing: this takes a moment.');
            }}
          >
            <DownloadIcon /> Install msmtp
          </Button>
        )}
        {install?.package === 'msmtp' && install.ok === false && (
          <p className="text-xs text-destructive">The last install didn’t work: {install.log?.split('\n').slice(-2).join(' ')}</p>
        )}
        {note !== undefined && <p className="text-xs text-muted-foreground">{note}</p>}
      </section>
    );
  }
  const bad =
    f.host === '' || !/^[A-Za-z0-9.-]+$/.test(f.host) || f.port < 1 || f.port > 65535 || !/^[^@\s]+@[^@\s]+$/.test(f.from);
  const input = (
    k: keyof MailSettings,
    label: string,
    props: Partial<{ type: string; placeholder: string; mono: boolean }> = {},
  ): ReactElement => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        type={props.type ?? 'text'}
        value={String(f[k])}
        placeholder={props.placeholder}
        className={cn(props.mono === true && 'font-mono text-xs')}
        autoComplete={k === 'password' ? 'new-password' : 'off'}
        onChange={(e) => {
          const n = Number(e.target.value);
          setF({ ...f, [k]: k === 'port' ? (Number.isNaN(n) ? 0 : n) : e.target.value });
        }}
      />
    </label>
  );
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Sending them</h3>
      <p className="text-xs text-muted-foreground">
        The mail server msmtp sends through, as the account {m?.profile ?? 'ban_notify'} in /etc/msmtprc (only root can read it).
        {m?.elsewhere === true ? ' That file has an account of this name of its own too: the one here comes after it.' : ''}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('host', 'Server', { placeholder: 'smtp.example.com', mono: true })}
        {input('port', 'Port', { type: 'number' })}
        <div className="grid gap-1 text-sm">
          <span id="banip-mail-tls" className="font-medium">
            Encryption
          </span>
          <Select
            value={f.tls}
            onValueChange={(v) => {
              setF({ ...f, tls: v as MailSettings['tls'] });
            }}
          >
            <SelectTrigger aria-labelledby="banip-mail-tls">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
              <SelectItem value="tls">TLS (port 465)</SelectItem>
              <SelectItem value="off">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {input('from', 'Sent as', { placeholder: 'router@example.com', mono: true })}
        {input('user', 'User name')}
        {input('password', m?.password === true ? 'Password (kept if empty)' : 'Password', { type: 'password' })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== undefined || bad}
          onClick={() => {
            run('save', () => saveMail(f), 'Saved.');
          }}
        >
          {busy === 'save' && <LoaderCircleIcon className="animate-spin" />}
          Save the account
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => {
            run('test', testMail, 'Sent: it goes out with the next minute. msmtp’s answer is in the system log.');
          }}
        >
          Send a test mail
        </Button>
      </div>
      {note !== undefined && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

const tabOf = (name: OptionName): TabId => {
  for (const [tab, groups] of Object.entries(FIELDS) as [TabId, (typeof FIELDS)[TabId]][])
    if (groups.some((g) => g.fields.some((f) => f.name === name))) return tab;
  return name === 'ban_logterm' ? 'logging' : 'general';
};

export function AdvancedSheet({
  c,
  onClose,
  onSave,
  onChanged,
}: {
  c: BanipConfig;
  onClose: () => void;
  onSave: (changes: Options) => void;
  onChanged: () => void;
}): ReactElement {
  const id = useId();
  const names = [...Object.values(FIELDS).flatMap((g) => g.flatMap((x) => x.fields.map((f) => f.name))), 'ban_logterm' as const];
  const saved: Options = {};
  for (const n of names) saved[n] = c.options?.[n] ?? null;
  const [o, setO] = useState<Options>(saved);
  const [tab, setTab] = useState<TabId>('general');
  const set = (n: OptionName, v: OptionValue): void => {
    setO((x) => ({ ...x, [n]: v }));
  };
  const feeds = new Set((c.catalogue ?? []).map((f) => f.name));
  const errors: Partial<Record<OptionName, string>> = {};
  for (const n of names) {
    const e = checkValue(n, o[n] ?? null, { feeds });
    if (e !== null) errors[n] = ERR[e] ?? e;
  }
  const split = Number(effective(o, 'ban_splitsize'));
  if (split > 0 && split < 512) errors.ban_splitsize = '0, or 512 and more.';
  const wrong = new Set(Object.keys(errors).map((k) => tabOf(k as OptionName)));
  const changes = optionChanges(saved, o);
  const count = Object.keys(changes).length;
  const invalid = Object.keys(errors).length > 0;
  return (
    <Sheet
      open
      onOpenChange={(x) => {
        if (!x) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`} className="sm:max-w-2xl">
        <div className="pt-4">
          <div className="px-6">
            <SheetTitle className="pr-8">Advanced banIP settings</SheetTitle>
            <SheetDescription id={`${id}-desc`} className="mt-0.5 text-xs">
              Everything else banIP takes, as in LuCI. Only what you change is saved; most of it restarts banIP for a moment.
            </SheetDescription>
          </div>
          <Tabs
            label="Settings"
            prefix="banip-adv"
            value={tab}
            onChange={setTab}
            className="mt-3 px-6"
            items={TABS.map((t) => ({
              id: t.id,
              label: (
                <span className="flex items-center gap-1.5">
                  <t.icon className="size-3.5" aria-hidden="true" />
                  {t.label}
                  {wrong.has(t.id) && (
                    <>
                      <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                      <span className="sr-only">(has a problem)</span>
                    </>
                  )}
                </span>
              ),
            }))}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* each tab's content only while it's shown: the Email tab asks the router for its account as it opens */}
          {TABS.map((t) => (
            <TabPanel key={t.id} prefix="banip-adv" id={t.id} value={tab} className="flex flex-col gap-6 px-6 py-5">
              {tab === t.id && (
                <>
                  {t.id === 'general' && c.runtime !== null && c.runtime !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      banIP found: {c.runtime.devices.length > 0 ? c.runtime.devices.join(', ') : 'no device'} (
                      {c.runtime.interfaces.length > 0 ? c.runtime.interfaces.join(', ') : 'no interface'})
                      {c.runtime.uplink.length > 0 ? `, its own addresses ${c.runtime.uplink.join(', ')}` : ''}. Its table has{' '}
                      {c.runtime.counts !== null && c.runtime.counts !== undefined
                        ? `${String(c.runtime.counts.chains)} chains, ${String(c.runtime.counts.sets)} sets and ${String(c.runtime.counts.rules)} rules`
                        : 'nothing loaded'}
                      ; it uses {String(c.runtime.system.cores)} cores and {c.runtime.system.fetch ?? 'no download tool'}.
                    </p>
                  )}
                  {FIELDS[t.id].map((g) => (
                    <section key={g.title} className="flex flex-col gap-4">
                      <h3 className="text-sm font-semibold">{g.title}</h3>
                      {g.fields.map((d) => (
                        <Row key={d.name} def={d} o={o} saved={saved} c={c} set={set} error={errors[d.name]} />
                      ))}
                      {g.title === 'The log monitor' && <LogTerms o={o} set={set} />}
                    </section>
                  ))}
                  {t.id === 'firewall' && (c.managed?.wireguard.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Always let through by MilkFlint: UDP {c.managed?.wireguard.join(', ')} (WireGuard: Remote access), so
                      devices away from home connect whatever the lists say.
                    </p>
                  )}
                  {t.id === 'downloads' && <CustomFile c={c} onChanged={onChanged} />}
                  {t.id === 'email' && <MailAccountForm c={c} onChanged={onChanged} />}
                </>
              )}
            </TabPanel>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {invalid
              ? 'Fix what’s marked to save.'
              : count === 0
                ? 'No changes yet.'
                : `${String(count)} option${count === 1 ? '' : 's'} to change.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={invalid || count === 0}
              onClick={() => {
                onSave(changes);
              }}
            >
              Save &amp; apply
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
