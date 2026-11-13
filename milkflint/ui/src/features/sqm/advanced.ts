// Smart Queue's advanced settings: what sqm-scripts and CAKE take for the
// internet port's queue, as LuCI has them, in one sheet. Each direction's
// CAKE keywords (sqm's iqdisc_opts for the download, eqdisc_opts for the
// upload) are read into settings by group, since CAKE takes the last of a
// group ("diffserv3 ... besteffort" is besteffort); keywords no setting
// covers stay as Other options. A save writes only what changed: an
// unchanged group keeps its place and its words in the opts, and an
// unchanged sqm option isn't written.
//
// sqm-scripts gives CAKE "diffserv3 nat" in both directions, then
// piece_of_cake.qos adds besteffort, layer_cake.qos besteffort on the
// download while squash_ingress is on (its default), and both add wash to
// the download while squash_dscp is on (its default). The opts come last.
// The fq_codel-only options (limits, targets, ECN) don't apply to CAKE.
import { bool, type Change, type Section, sectionChanges, str } from '@/lib/api/uci';
import { takesWhole, type Whole, wholeOf, wholeValue, words } from './gso';

export type Direction = 'down' | 'up';

/** CAKE's keyword groups this sheet has a setting for */
const GROUPS = {
  diffserv: ['besteffort', 'diffserv3', 'diffserv4', 'diffserv8', 'precedence'],
  isolation: ['flowblind', 'srchost', 'dsthost', 'hosts', 'flows', 'dual-srchost', 'dual-dsthost', 'triple-isolate'],
  nat: ['nat', 'nonat'],
  wash: ['wash', 'nowash'],
  ingress: ['ingress', 'egress'],
  ackFilter: ['ack-filter', 'ack-filter-aggressive', 'no-ack-filter'],
  gso: ['split-gso', 'no-split-gso'],
  rtt: ['rtt', 'datacentre', 'lan', 'metro', 'regional', 'internet', 'oceanic', 'satellite', 'interplanetary'],
  memlimit: ['memlimit'],
  autorate: ['autorate-ingress'],
  fwmark: ['fwmark'],
  ptm: ['ptm'],
} as const;
type Group = keyof typeof GROUPS;
const GROUP_NAMES = Object.keys(GROUPS) as Group[];

/** keywords followed by a value */
const TAKES_VALUE = new Set(['rtt', 'memlimit', 'fwmark', 'mpu', 'overhead']);
/** keywords sqm-scripts writes itself: not for Other options */
const SQM_OWN = new Set(['bandwidth', 'unlimited']);

export const RTT_PRESETS = ['datacentre', 'lan', 'metro', 'regional', 'internet', 'oceanic', 'satellite', 'interplanetary'] as const;

export interface DirectionForm {
  /** '': the script's (see scriptTins) */
  diffserv: string;
  /** '': CAKE's own, triple-isolate */
  isolation: string;
  /** '': sqm's, nat */
  nat: '' | 'nat' | 'nonat';
  /** '': the default (the download's follows squash_dscp, the upload's doesn't wash) */
  wash: '' | 'wash' | 'nowash';
  /** '': CAKE's egress mode; the download's queue wants ingress */
  ingress: '' | 'ingress' | 'egress';
  ackFilter: '' | 'ack-filter' | 'ack-filter-aggressive' | 'no-ack-filter';
  /** '': CAKE's (split) */
  gso: '' | 'split-gso' | 'no-split-gso';
  /** '': CAKE's 100 ms; a preset's name, or a time ("50ms") */
  rtt: string;
  /** '': CAKE's own */
  memlimit: string;
  autorate: boolean;
  fwmark: string;
  ptm: boolean;
  /** the keywords no setting covers, as typed */
  extra: string;
}

export interface AdvancedForm {
  down: DirectionForm;
  up: DirectionForm;
  /** whether the download's CAKE takes GRO packets whole (./gso.ts); manages its gso group */
  whole: Whole;
  script: string;
  /** squash_dscp: the download's CAKE clears DSCP marks (sqm's default) */
  squashDscp: boolean;
  /** squash_ingress: the download's CAKE ignores DSCP for its tins (sqm's default) */
  squashIngress: boolean;
  linklayer: string;
  overhead: string;
  /** tcMPU; '' unset */
  mpu: string;
  /** linklayer_adaptation_mechanism; '' unset (default: CAKE's own for CAKE) */
  llam: string;
  /** tcMTU, tcTSIZE: tc_stab's; '' unset */
  mtu: string;
  tsize: string;
  /** use_mq_egress: '' like the download (use_mq) */
  mqEgress: '' | '1' | '0';
  debug: boolean;
  /** verbosity; '' sqm's (5) */
  verbosity: string;
}

export interface AdvancedData {
  form: AdvancedForm;
  section: string;
  /** the WAN port it shapes; the download's CAKE is on its ifb */
  device: string;
  queue: Section;
  milkflint: Section[];
  downloadKbit: number;
  uploadKbit: number;
  useMq: boolean;
  /** Keep devices' priorities on downloads sets squash_dscp and squash_ingress */
  dscpRestore: boolean;
}

interface Item {
  group: Group | 'extra';
  words: string[];
}

const groupOf = (word: string): Group | undefined => GROUP_NAMES.find((g) => (GROUPS[g] as readonly string[]).includes(word));

/** opts as items: a keyword with its value, by group */
function itemsOf(opts: string | undefined): Item[] {
  const w = words(opts);
  const items: Item[] = [];
  for (let i = 0; i < w.length; i++) {
    const word = w[i] ?? '';
    const takes = TAKES_VALUE.has(word) && i + 1 < w.length;
    items.push({ group: groupOf(word) ?? 'extra', words: takes ? [word, w[++i] ?? ''] : [word] });
  }
  return items;
}

/** a direction's settings from its opts: the last of each group, as CAKE takes it */
export function directionOf(opts: string | undefined): DirectionForm {
  const items = itemsOf(opts);
  const last = (g: Group): string[] | undefined => items.findLast((i) => i.group === g)?.words;
  const one = (g: Group): string => last(g)?.[0] ?? '';
  const value = (g: Group): string => last(g)?.[1] ?? '';
  const rtt = last('rtt');
  return {
    diffserv: one('diffserv'),
    isolation: one('isolation'),
    nat: one('nat') as DirectionForm['nat'],
    wash: one('wash') as DirectionForm['wash'],
    ingress: one('ingress') as DirectionForm['ingress'],
    ackFilter: one('ackFilter') as DirectionForm['ackFilter'],
    gso: one('gso') as DirectionForm['gso'],
    rtt: rtt === undefined ? '' : rtt[0] === 'rtt' ? (rtt[1] ?? '') : (rtt[0] ?? ''),
    memlimit: value('memlimit'),
    autorate: last('autorate') !== undefined,
    fwmark: value('fwmark'),
    ptm: last('ptm') !== undefined,
    extra: items
      .filter((i) => i.group === 'extra')
      .flatMap((i) => i.words)
      .join(' '),
  };
}

/** a group's words for a direction's settings */
function groupWords(d: DirectionForm, g: Group): string[] {
  switch (g) {
    case 'rtt':
      return d.rtt === '' ? [] : (RTT_PRESETS as readonly string[]).includes(d.rtt) ? [d.rtt] : ['rtt', d.rtt];
    case 'memlimit':
      return d.memlimit === '' ? [] : ['memlimit', d.memlimit];
    case 'fwmark':
      return d.fwmark === '' ? [] : ['fwmark', d.fwmark];
    case 'autorate':
      return d.autorate ? ['autorate-ingress'] : [];
    case 'ptm':
      return d.ptm ? ['ptm'] : [];
    case 'diffserv':
    case 'isolation':
    case 'nat':
    case 'wash':
    case 'ingress':
    case 'ackFilter':
    case 'gso':
      return d[g] === '' ? [] : [d[g]];
  }
}

/**
 * The direction's opts with the changed settings: a changed group's words
 * go (all of them) and its new ones go at the end; the rest stay as they
 * were. undefined: nothing changed.
 */
export function optsWith(current: string | undefined, was: DirectionForm, now: DirectionForm): string | undefined {
  let items = itemsOf(current);
  let changed = false;
  for (const g of GROUP_NAMES) {
    const wanted = groupWords(now, g);
    if (wanted.join(' ') === groupWords(was, g).join(' ')) continue;
    changed = true;
    items = items.filter((i) => i.group !== g);
    if (wanted.length > 0) items.push({ group: g, words: wanted });
  }
  if (words(now.extra).join(' ') !== words(was.extra).join(' ')) {
    changed = true;
    items = [...items.filter((i) => i.group !== 'extra'), { group: 'extra', words: words(now.extra) }];
  }
  return changed ? items.flatMap((i) => i.words).join(' ') : undefined;
}

export function advancedData(queue: Section, milkflint: Section[]): AdvancedData {
  const downloadKbit = Number(str(queue, 'download') ?? '0');
  const iq = str(queue, 'iqdisc_opts');
  const mqEgress = str(queue, 'use_mq_egress');
  const cake = milkflint.find((s) => s['.name'] === 'cake');
  return {
    form: {
      down: directionOf(iq),
      up: directionOf(str(queue, 'eqdisc_opts')),
      whole: wholeOf(str(milkflint.find((s) => s['.name'] === 'gro'), 'whole'), iq, downloadKbit),
      script: str(queue, 'script') ?? '',
      squashDscp: str(queue, 'squash_dscp') !== '0',
      squashIngress: str(queue, 'squash_ingress') !== '0',
      linklayer: str(queue, 'linklayer') ?? 'none',
      overhead: str(queue, 'overhead') ?? '0',
      mpu: str(queue, 'tcMPU') ?? '',
      llam: str(queue, 'linklayer_adaptation_mechanism') ?? '',
      mtu: str(queue, 'tcMTU') ?? '',
      tsize: str(queue, 'tcTSIZE') ?? '',
      mqEgress: mqEgress === '1' || mqEgress === '0' ? mqEgress : '',
      debug: bool(queue, 'debug_logging'),
      verbosity: str(queue, 'verbosity') ?? '',
    },
    section: queue['.name'],
    device: str(queue, 'interface') ?? '',
    queue,
    milkflint,
    downloadKbit,
    uploadKbit: Number(str(queue, 'upload') ?? '0'),
    useMq: bool(queue, 'use_mq'),
    dscpRestore: str(cake, 'dscp_restore') === '1',
  };
}

export type AdvancedErrors = Partial<Record<string, string>>;

const TIME = /^\d+(?:\.\d+)?(?:us|ms|s)$/;
const SIZE = /^\d+(?:\.\d+)?(?:b|k|kb|kbit|m|mb|mbit|g|gb|gbit)?$/i;
const MARK = /^(?:0x[0-9a-f]{1,8}|\d{1,10})$/i;
const int = (v: string, min: number, max: number): boolean => /^-?\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

/** errors by field: "down.rtt", "overhead", ... */
export function validateAdvanced(f: AdvancedForm, data: AdvancedData): AdvancedErrors {
  const e: AdvancedErrors = {};
  // the kernel refuses it with multi-queue CAKE, and the download then goes unshaped
  if (f.down.autorate && data.useMq) e['down.autorate'] = 'Not with multi-queue CAKE, which can’t: turn Multi-queue off on the page first.';
  for (const dir of ['down', 'up'] as const) {
    const d = f[dir];
    if (d.rtt !== '' && !(RTT_PRESETS as readonly string[]).includes(d.rtt) && !TIME.test(d.rtt)) e[`${dir}.rtt`] = 'A time such as 50ms, 1s or 500us.';
    if (d.memlimit !== '' && !SIZE.test(d.memlimit)) e[`${dir}.memlimit`] = 'Bytes, or with a unit: 4mb, 512kb.';
    if (d.fwmark !== '' && !MARK.test(d.fwmark)) e[`${dir}.fwmark`] = 'A mask such as 0xff.';
    const extra = words(d.extra);
    const taken = extra.find((w) => groupOf(w) !== undefined || SQM_OWN.has(w));
    const last = extra.at(-1);
    if (taken !== undefined) e[`${dir}.extra`] = SQM_OWN.has(taken) ? `sqm sets ${taken} itself.` : `${taken} has its own setting above.`;
    else if (last !== undefined && TAKES_VALUE.has(last)) e[`${dir}.extra`] = `${last} needs a value after it.`;
    else if (extra.some((w) => !/^[\w.:-]+$/.test(w))) e[`${dir}.extra`] = 'CAKE keywords only: letters, digits, dots, colons and dashes.';
  }
  if (!int(f.overhead, -64, 256)) e['overhead'] = 'Bytes, -64 to 256.';
  if (f.mpu !== '' && !int(f.mpu, 0, 256)) e['mpu'] = 'Bytes, 0 to 256.';
  if (f.mtu !== '' && !int(f.mtu, 0, 65535)) e['mtu'] = 'Bytes, up to 65535.';
  if (f.tsize !== '' && !int(f.tsize, 1, 65535)) e['tsize'] = 'Entries, 1 to 65535.';
  return e;
}

/** A direction's settings as saved: the GRO choice sets the download's gso group, when CAKE doesn't already do what it gives. */
function directionWith(f: AdvancedForm, data: AdvancedData, dir: Direction): DirectionForm {
  if (dir === 'up' || f.whole === data.form.whole) return f[dir];
  const whole = takesWhole(data.downloadKbit, f.whole);
  return whole === (data.form.down.gso === 'no-split-gso') ? f.down : { ...f.down, gso: whole ? 'no-split-gso' : '' };
}

/** The changes that save the sheet: only what changed. */
export function advancedChanges(f: AdvancedForm, data: AdvancedData): Change[] {
  const was = data.form;
  const values: Record<string, string> = {};
  const unset: string[] = [];
  const put = (option: string, value: string, wasValue: string): void => {
    if (value === wasValue) return;
    if (value === '') unset.push(option);
    else values[option] = value;
  };

  put('script', f.script, was.script);
  if (!data.dscpRestore) {
    if (f.squashDscp !== was.squashDscp) values['squash_dscp'] = f.squashDscp ? '1' : '0';
    if (f.squashIngress !== was.squashIngress) values['squash_ingress'] = f.squashIngress ? '1' : '0';
    // LuCI keeps these only in its advanced mode: without it, its next save drops them
    if (('squash_dscp' in values || 'squash_ingress' in values) && str(data.queue, 'qdisc_advanced') !== '1') values['qdisc_advanced'] = '1';
  }
  put('linklayer', f.linklayer, was.linklayer);
  put('overhead', f.overhead, was.overhead);
  put('tcMPU', f.mpu, was.mpu);
  put('linklayer_adaptation_mechanism', f.llam, was.llam);
  put('tcMTU', f.mtu, was.mtu);
  put('tcTSIZE', f.tsize, was.tsize);
  // LuCI shows these only in its advanced link-layer mode
  if (Object.keys(values).some((k) => ['tcMPU', 'linklayer_adaptation_mechanism', 'tcMTU', 'tcTSIZE'].includes(k))) values['linklayer_advanced'] = '1';
  put('use_mq_egress', f.mqEgress, was.mqEgress);
  if (f.debug !== was.debug) values['debug_logging'] = f.debug ? '1' : '0';
  put('verbosity', f.verbosity, was.verbosity);

  for (const [key, dir] of [
    ['iqdisc_opts', 'down'],
    ['eqdisc_opts', 'up'],
  ] as const) {
    const opts = optsWith(str(data.queue, key), was[dir], directionWith(f, data, dir));
    if (opts === undefined) continue;
    if (opts !== '') {
      values[key] = opts;
      // LuCI shows these options only in its advanced mode
      for (const mode of ['qdisc_advanced', 'qdisc_really_really_advanced']) if (str(data.queue, mode) !== '1') values[mode] = '1';
    } else if (str(data.queue, key) !== undefined) {
      unset.push(key);
    }
  }

  const changes: Change[] = [];
  if (Object.keys(values).length > 0) changes.push({ op: 'set', config: 'sqm', section: data.section, values });
  if (unset.length > 0) changes.push({ op: 'unset', config: 'sqm', section: data.section, options: unset });
  if (f.whole !== was.whole) changes.push(...sectionChanges('milkflint', data.milkflint, 'gro', { whole: wholeValue(f.whole) }));
  return changes;
}

/** the tins a script gives a direction when its opts don't choose */
export function scriptTins(script: string, dir: Direction, squashIngress: boolean): string {
  if (script === 'layer_cake.qos') return dir === 'down' && squashIngress ? 'besteffort' : 'diffserv3';
  return 'besteffort';
}

/**
 * What sqm-scripts gives tc for a direction's CAKE with these settings, as
 * its piece_of_cake.qos and layer_cake.qos build it: the qdisc and its
 * arguments, without the device.
 */
export function cakeArgs(f: AdvancedForm, data: AdvancedData, dir: Direction): string[] {
  const c = cakeCommand(f, data, dir);
  return [...c.sqm, ...c.opts];
}

/** value, or sqm-scripts' default when it's unset */
const or = (value: string, fallback: string): string => (value === '' ? fallback : value);

/** cakeArgs in two parts: what sqm-scripts puts first, then the direction's opts */
export function cakeCommand(f: AdvancedForm, data: AdvancedData, dir: Direction): { sqm: string[]; opts: string[] } {
  const down = dir === 'down';
  const mq = down ? data.useMq : f.mqEgress === '' ? data.useMq : f.mqEgress === '1';
  const kbit = down ? data.downloadKbit : data.uploadKbit;
  const llam = f.llam === '' || f.llam === 'default' ? 'cake' : f.llam;
  const stab =
    llam === 'tc_stab' && f.linklayer !== 'none'
      ? ['stab', 'mtu', or(f.mtu, '2047'), 'tsize', or(f.tsize, '512'), 'mpu', or(f.mpu, '0'), 'overhead', f.overhead, 'linklayer', f.linklayer]
      : [];
  const lla = llam === 'cake' && f.linklayer !== 'none' ? [...(f.linklayer === 'atm' ? ['atm'] : []), 'overhead', f.overhead, 'mpu', or(f.mpu, '0')] : [];
  const script = ['diffserv3', 'nat'];
  if (f.script !== 'layer_cake.qos') script.push('besteffort');
  else if (down && f.squashIngress) script.push('besteffort');
  if (down && f.squashDscp) script.push('wash');
  const current = str(data.queue, down ? 'iqdisc_opts' : 'eqdisc_opts');
  const opts = words(optsWith(current, data.form[dir], directionWith(f, data, dir)) ?? current);
  return { sqm: [...stab, mq ? 'cake_mq' : 'cake', 'bandwidth', `${String(kbit)}kbit`, ...lla, ...script], opts };
}

/** What CAKE does with these arguments: the last of each group, or CAKE's default */
export function cakeEffect(args: readonly string[]): Record<Exclude<Group, 'memlimit' | 'fwmark' | 'ptm' | 'autorate'>, string> {
  const last = (g: Group, fallback: string): string => args.findLast((w) => (GROUPS[g] as readonly string[]).includes(w)) ?? fallback;
  const rttAt = args.findLastIndex((w) => (GROUPS.rtt as readonly string[]).includes(w));
  const rttWord = args[rttAt];
  return {
    diffserv: last('diffserv', 'diffserv3'),
    isolation: last('isolation', 'triple-isolate'),
    nat: last('nat', 'nonat'),
    wash: last('wash', 'nowash'),
    ingress: last('ingress', 'egress'),
    ackFilter: last('ackFilter', 'no-ack-filter'),
    gso: last('gso', 'split-gso'),
    rtt: rttWord === undefined ? '100ms' : rttWord === 'rtt' ? (args[rttAt + 1] ?? '100ms') : rttWord,
  };
}
