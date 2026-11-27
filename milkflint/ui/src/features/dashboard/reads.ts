// Home's own reads: what its widgets show that no page reads the same way.
// The queries over them are in queries.ts.
import { getHostHints, hintName } from '@/lib/api/network';
import { loadNames } from '@/lib/api/names';
import { bool, getConfig, type Section, str } from '@/lib/api/uci';
import { getPeriods, getUsage, loadRouterIps } from '../data-statistics/api';
import { deviceRules, parsePeople } from '../device-control/model';
import { entries } from '../device-control/view';
import { parseFirewall } from '../firewall/model';
import { SERVER } from '../remote-access/sections';
import { readCrontab } from '../schedules/api';
import { type Task, tasksFrom } from '../schedules/model';
import { zoneChosen } from '../time/zone';
import { CLIENT } from '../vpn-client/sections';

export interface Usage {
  /** the current accounting period's start (YYYY-MM-DD) */
  start: string | undefined;
  rx: number;
  tx: number;
  /** `name` undefined when it has none; `address` its IPv4 address, else its MAC */
  top: { key: string; name: string | undefined; address: string; rx: number; tx: number }[];
}

/** The current period's totals and busiest devices; 'off' while Data usage is off, 'missing' without it. */
export async function loadUsage(): Promise<Usage | 'off' | 'missing'> {
  const periods = await getPeriods();
  if (!periods.installed) return 'missing';
  if (periods.enabled === false) return 'off';
  const [rows, names, routerIps] = await Promise.all([getUsage('', 'mac'), loadNames(), loadRouterIps()]);
  const devices = rows.filter((r) => r.ip === undefined || !routerIps.has(r.ip));
  return {
    start: periods.periods[0],
    rx: devices.reduce((n, r) => n + r.rx, 0),
    tx: devices.reduce((n, r) => n + r.tx, 0),
    top: devices
      .slice(0, 4)
      .map((r) => ({ key: r.key, name: names.get(r.key.toLowerCase()), address: r.ip ?? r.key, rx: r.rx, tx: r.tx })),
  };
}

/** Each device's name on Remote access, by its public key (the page keeps them as the peers' descriptions). */
export async function peerNames(): Promise<Map<string, string>> {
  const sections = await getConfig('network');
  return new Map(
    sections
      .filter((s) => s['.type'] === `wireguard_${SERVER}`)
      .flatMap((s) => {
        const key = str(s, 'public_key');
        const name = str(s, 'description');
        return key === undefined || name === undefined ? [] : [[key, name] as const];
      }),
  );
}

/** Whether the VPN's kill switch is on: network.wg_out_kill, there and not disabled. */
export async function vpnKillSwitch(): Promise<boolean> {
  return (await getConfig('network')).some((s) => s['.name'] === `${CLIENT}_kill` && !bool(s, 'disabled'));
}

export interface People {
  list: ReturnType<typeof entries>;
  rules: ReturnType<typeof deviceRules>;
}

/** Device control's groups and devices, with names, and the firewall rules that make them. */
export async function loadPeople(): Promise<People> {
  const [firewall, milkflint, hints] = await Promise.all([
    getConfig('firewall'),
    getConfig('milkflint').catch((): Section[] => []),
    getHostHints().catch(() => ({})),
  ]);
  const names = new Map(Object.entries(hints).map(([mac, h]) => [mac.toLowerCase(), hintName(h)]));
  const cfg = parseFirewall(firewall, milkflint);
  const name = (mac: string): string | undefined => names.get(mac);
  return { list: entries(cfg, firewall, parsePeople(milkflint), name), rules: deviceRules(cfg) };
}

/** The scheduled tasks, from root's crontab. */
export async function loadTasks(): Promise<Task[]> {
  return tasksFrom(await readCrontab());
}

/** Whether a time zone has been chosen (Name & time, or LuCI). */
export async function timeZoneChosen(): Promise<boolean> {
  return zoneChosen((await getConfig('system')).find((s) => s['.type'] === 'system'));
}
