// How each kind of phase looks: a colour from the charts' palette (download
// blue, upload rust, as the CPU lanes use them) for its bar and its icon, an
// icon and a name.
import {
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  CableIcon,
  GlobeIcon,
  HouseIcon,
  type LucideIcon,
  PauseIcon,
  RadioTowerIcon,
  SnowflakeIcon,
} from 'lucide-react';
import type { Phase, PhaseKind } from './api';
import { phaseNames } from './phase-names';

export const phaseStyle: Record<PhaseKind, { name: string; icon: LucideIcon; bar: string; tone: string }> = {
  idle: { name: phaseNames.idle, icon: PauseIcon, bar: 'bg-muted-foreground/35', tone: 'text-muted-foreground' },
  wan_down: { name: phaseNames.wan_down, icon: ArrowDownIcon, bar: 'bg-chart-2', tone: 'text-chart-2' },
  wan_up: { name: phaseNames.wan_up, icon: ArrowUpIcon, bar: 'bg-chart-1', tone: 'text-chart-1' },
  wan_both: {
    name: phaseNames.wan_both,
    icon: ArrowDownUpIcon,
    bar: 'bg-[color-mix(in_oklab,var(--chart-1)_50%,var(--chart-2))]',
    tone: 'text-chart-2',
  },
  connect: { name: phaseNames.connect, icon: CableIcon, bar: 'bg-chart-3/50', tone: 'text-chart-3' },
  d2d: { name: phaseNames.d2d, icon: RadioTowerIcon, bar: 'bg-chart-3', tone: 'text-chart-3' },
  dns: { name: phaseNames.dns, icon: GlobeIcon, bar: 'bg-chart-4', tone: 'text-chart-4' },
  household: { name: phaseNames.household, icon: HouseIcon, bar: 'bg-primary', tone: 'text-primary' },
  cooldown: { name: phaseNames.cooldown, icon: SnowflakeIcon, bar: 'bg-muted-foreground/15', tone: 'text-muted-foreground' },
};

/** 65_000 -> "1:05" */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Who does what in a phase, in words: "Mac downloads", "iPhone sends to Mac". */
export function phaseRoles(p: Phase, names: ReadonlyMap<string, string>): string {
  const name = (id: string): string => names.get(id) ?? id;
  const by = (role: string): string[] =>
    Object.entries(p.roles)
      .filter(([, r]) => r === role)
      .map(([id]) => name(id));
  const list = (xs: string[]): string => (xs.length <= 2 ? xs.join(' and ') : `${String(xs.length)} devices`);
  switch (p.kind) {
    case 'wan_down':
    case 'wan_up':
    case 'wan_both': {
      const role = p.kind === 'wan_down' ? 'down' : p.kind === 'wan_up' ? 'up' : 'both';
      const who = by(role);
      const verb = p.kind === 'wan_down' ? 'download' : p.kind === 'wan_up' ? 'upload' : 'download and upload';
      return who.length === 0 ? '' : `${list(who)} ${who.length === 1 ? `${verb}s` : verb}; everyone measures latency`;
    }
    case 'd2d': {
      const [a, b] = p.pair ?? [];
      if (a === undefined || b === undefined) return '';
      return p.dir === 'ba'
        ? `${name(b)} sends to ${name(a)}`
        : p.dir === 'both'
          ? `${name(a)} and ${name(b)} send both ways`
          : `${name(a)} sends to ${name(b)}`;
    }
    case 'connect':
      return 'Devices set up direct connections to each other';
    case 'dns':
      return 'Every device and the router look up and load popular sites';
    case 'household':
      return 'Downloads, uploads, device-to-device traffic and browsing at once';
    case 'idle':
      return 'Every device measures latency with nothing else going on';
    case 'cooldown':
      return 'Nothing runs while the queues drain; the router keeps recording';
  }
}
