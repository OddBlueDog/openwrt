import { type Section, str } from '@/lib/api/uci';

/**
 * Whether anyone has picked a time zone: a new router has OpenWrt's first-boot
 * values, UTC and GMT0. Picking from the page's list writes another zone or, for
 * UTC itself, the rule UTC0.
 */
export function zoneChosen(system: Section | undefined): boolean {
  const name = str(system, 'zonename');
  const rule = str(system, 'timezone');
  return !((name === undefined || name === 'UTC') && (rule === undefined || rule === 'GMT0'));
}

/** The router's list of zones, which doesn't have UTC, with it first. */
export function withUtc<T extends { name: string; tz: string }>(zones: readonly T[]): (T | { name: string; tz: string })[] {
  return zones.length === 0 || zones.some((z) => z.name === 'UTC') ? [...zones] : [{ name: 'UTC', tz: 'UTC0' }, ...zones];
}
