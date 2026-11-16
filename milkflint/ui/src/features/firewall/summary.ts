// The Firewall page's answer, worked out from the config: what the internet
// can start connections to (the router itself, your devices), and whose
// rules there are (yours, MilkFlint's other pages', OpenWrt's own). Also how
// the rules table folds OpenWrt's standard rules away for a newcomer and
// where a rule moves to when they're folded.
import {
  type FirewallConfig,
  isBuiltIn,
  isDeviceBlock,
  isDmz,
  isInternetForward,
  isInternetZone,
  managedBy,
  type Rule,
} from './model';

/** Who made a rule: you, another MilkFlint page, or OpenWrt (its standard rules). */
export type Origin = 'own' | 'page' | 'openwrt';

export function ruleOrigin(r: Rule): Origin {
  if (managedBy[r.section] !== undefined) return 'page';
  return isBuiltIn(r) ? 'openwrt' : 'own';
}

/** A row of a chain in the rules table: a rule, or a run of OpenWrt's rules folded into one. */
export type RuleRow = { kind: 'rule'; rule: Rule } | { kind: 'openwrt'; rules: Rule[] };

/**
 * A chain's rules as rows. With `show` off, each run of OpenWrt's standard
 * rules is one row in its place, so the order (which decides) still reads.
 */
export function foldOpenWrt(rules: readonly Rule[], show: boolean): RuleRow[] {
  const rows: RuleRow[] = [];
  for (const rule of rules) {
    const last = rows.at(-1);
    if (show || ruleOrigin(rule) !== 'openwrt') rows.push({ kind: 'rule', rule });
    else if (last?.kind === 'openwrt') last.rules.push(rule);
    else rows.push({ kind: 'openwrt', rules: [rule] });
  }
  return rows;
}

/**
 * The rule a move up or down puts this one next to: the neighbouring row's,
 * so a folded run is stepped over whole (before its first rule going up,
 * after its last going down). Undefined at either end.
 */
export function moveTarget(rows: readonly RuleRow[], section: string, dir: 'up' | 'down'): string | undefined {
  const i = rows.findIndex((r) => r.kind === 'rule' && r.rule.section === section);
  if (i < 0) return undefined;
  const next = rows[dir === 'up' ? i - 1 : i + 1];
  if (next === undefined) return undefined;
  if (next.kind === 'rule') return next.rule.section;
  return (dir === 'up' ? next.rules[0] : next.rules.at(-1))?.section;
}

/** closed: nothing from the internet can start a connection; some: what rules or forwards open; open: everything. */
export type Reach = 'closed' | 'some' | 'open';

export interface FirewallSummary {
  /** the internet to the router itself */
  router: {
    reach: Reach;
    /** rules of yours or MilkFlint's pages that let the internet in to the router */
    opened: Rule[];
    /** OpenWrt's standard rules that do */
    openwrt: number;
    /** port forwards from the internet to the router itself that are on */
    forwards: number;
  };
  /** the internet to your devices */
  devices: {
    reach: Reach;
    /** zones any connection from the internet may go on to (a forwarding, or the defaults' forward policy) */
    zones: string[];
    /** port forwards from the internet to a device that are on */
    forwards: number;
    /** one of them forwards every port */
    dmz: boolean;
    /** ports devices opened themselves (UPnP), when known */
    upnp: number;
    /** rules of yours or MilkFlint's pages that let the internet through to a zone */
    opened: Rule[];
    openwrt: number;
  };
  rules: {
    own: number;
    page: number;
    openwrt: number;
    /** of all of them, how many are off */
    off: number;
    /** devices kept off the internet (Block a device) */
    blocks: number;
  };
}

/** `upnp`: how many ports devices have opened, while UPnP is on. */
export function firewallSummary(cfg: FirewallConfig, upnp = 0): FirewallSummary {
  const wan = cfg.zones.filter(isInternetZone);
  const wanNames = new Set(wan.map((z) => z.name));
  const fromInternet = (r: Rule): boolean =>
    r.enabled && r.target === 'ACCEPT' && r.src !== undefined && (r.src === '*' || wanNames.has(r.src));

  const toRouter = cfg.rules.filter((r) => fromInternet(r) && r.dest === undefined);
  const through = cfg.rules.filter((r) => fromInternet(r) && r.dest !== undefined && !wanNames.has(r.dest));
  const mine = (r: Rule): boolean => ruleOrigin(r) !== 'openwrt';

  const routerOpened = toRouter.filter(mine);
  const allForwards = cfg.redirects.filter((r) => r.enabled && isInternetForward(r, cfg));
  const forwards = allForwards.filter((r) => r.destIp !== undefined);
  const routerForwards = allForwards.length - forwards.length;
  const routerReach: Reach = wan.some((z) => z.input === 'ACCEPT')
    ? 'open'
    : routerOpened.length + routerForwards > 0
      ? 'some'
      : 'closed';

  const zones = [
    ...new Set([
      ...cfg.forwardings.filter((f) => f.enabled && wanNames.has(f.src) && !wanNames.has(f.dest)).map((f) => f.dest),
      ...(wan.length > 0 && cfg.defaults.forward === 'ACCEPT'
        ? cfg.zones.filter((z) => !wanNames.has(z.name)).map((z) => z.name)
        : []),
    ]),
  ];
  const devicesOpened = through.filter(mine);
  const devicesReach: Reach = zones.length > 0 ? 'open' : forwards.length + upnp + devicesOpened.length > 0 ? 'some' : 'closed';

  return {
    router: {
      reach: routerReach,
      opened: routerOpened,
      openwrt: toRouter.length - routerOpened.length,
      forwards: routerForwards,
    },
    devices: {
      reach: devicesReach,
      zones,
      forwards: forwards.length,
      dmz: forwards.some(isDmz),
      upnp,
      opened: devicesOpened,
      openwrt: through.length - devicesOpened.length,
    },
    rules: {
      own: cfg.rules.filter((r) => ruleOrigin(r) === 'own').length,
      page: cfg.rules.filter((r) => ruleOrigin(r) === 'page').length,
      openwrt: cfg.rules.filter((r) => ruleOrigin(r) === 'openwrt').length,
      off: cfg.rules.filter((r) => !r.enabled).length,
      blocks: cfg.rules.filter((r) => r.enabled && isDeviceBlock(r, cfg)).length,
    },
  };
}

/** "Allow-SSH", "Allow-SSH and Plex", "Allow-SSH, Plex and 2 more". */
export function namesText(rules: readonly Rule[], max = 2): string {
  const names = rules.map((r) => r.name ?? r.label);
  if (names.length <= max) return new Intl.ListFormat('en-GB').format(names);
  return `${names.slice(0, max).join(', ')} and ${String(names.length - max)} more`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;
