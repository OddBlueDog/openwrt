// How a package's versions read on the Updates cards, and apk's order of them.
import type { UpdateInfo } from '@/lib/api/packages';

/** MilkFlint's package feed, where each version's source is kept (sources/<package>/<version>/SOURCE.txt). */
export const FEED_SITE = 'https://milkflint-packages.pages.dev';

/** The package's version as apk gives it ("1.9.1-r1005": the -r number is MilkFlint's build number, upstream's + 1000). */
export function versionLabel(v: string | null | undefined): string {
  return v === null || v === undefined || v === '' ? 'unknown' : v;
}

/** Upstream's own release number of one of MilkFlint's builds: 5 for 1.9.1-r1005 (MilkFlint's are upstream's + 1000). */
export function upstreamRelease(v: string | null | undefined): number | undefined {
  const m = /-r([0-9]+)$/.exec(v ?? '');
  const n = m === null ? NaN : Number(m[1]);
  return Number.isNaN(n) ? undefined : n >= 1000 ? n - 1000 : n;
}

/** apk's order of two versions (0.107.80-r1 after 0.107.79-r3), numbers as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/-r/, '.').split('.');
  const pb = b.replace(/-r/, '.').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] ?? 0);
    const y = Number(pb[i] ?? 0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface UpdateChoice {
  installed: string | undefined;
  latest: string | undefined;
  /** The feed has a newer one than the installed one. */
  newer: boolean;
  /** Earlier versions to go back to, newest first. */
  earlier: string[];
  /** Installed as an earlier version on purpose (pinned until the next update). */
  pinned: boolean;
}

export function updateChoice(installed: string | null | undefined, u: UpdateInfo | null | undefined): UpdateChoice {
  const have = installed ?? undefined;
  const versions = [...(u?.versions ?? [])].sort((a, b) => compareVersions(b, a));
  const latest = u?.latest ?? versions[0] ?? undefined;
  return {
    installed: have,
    latest,
    newer: have !== undefined && latest !== undefined && compareVersions(latest, have) > 0,
    earlier: have === undefined ? [] : versions.filter((v) => compareVersions(v, have) < 0),
    pinned: (u?.pinned ?? undefined) !== undefined && u?.pinned === have,
  };
}

/** The Updates card's "Newest tested" row: the version, or why there's none. */
export function newestText(u: UpdateInfo | null | undefined, latest: string | undefined): string {
  if (latest !== undefined) return versionLabel(latest);
  if (u?.error === 'feed') return 'couldn’t reach the feed';
  return u?.checked === null || u?.checked === undefined ? 'not checked yet' : 'no tested update for this release yet';
}

export interface RunMessage {
  tone: 'success' | 'error';
  text: string;
}

/** What the Updates card says of the last check or install, once it has finished: undefined for nothing to say. */
export function lastRunMessage(u: UpdateInfo | null | undefined, label: string): RunMessage | undefined {
  if (u === null || u === undefined || u.busy === true || u.ok === null || u.ok === undefined) return undefined;
  const error = (text: string): RunMessage => ({ tone: 'error', text });
  if (u.action === 'check') {
    if (u.ok) return undefined;
    return error(u.error === 'feed' ? 'The router couldn’t reach MilkFlint’s package feed.' : 'The last check didn’t work.');
  }
  if (u.action !== 'install') return undefined;
  const now = versionLabel(u.installed);
  if (u.ok) return { tone: 'success', text: `Installed ${now}.` };
  const back =
    u.back_on === true
      ? `, so ${now} is back on.`
      : u.back_on === false
        ? `, and the version before couldn’t go back on, so ${now} stays installed.`
        : '.';
  const reasons: Record<string, string> = {
    feed: 'The router couldn’t reach MilkFlint’s package feed, so nothing changed.',
    version: 'That version isn’t one MilkFlint has tested with this release, so nothing changed.',
    settings: `That version can’t read ${label}’s settings, which a newer version changed${back}`,
    after: `${label} didn’t work with that version${back}`,
    install: `The package didn’t install${back}`,
  };
  return error(reasons[u.error ?? ''] ?? `The last install didn’t work${back}`);
}
