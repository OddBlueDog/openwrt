// Smart Queue's experimental download settings, on the Advanced sheet's
// Download tab: sch_cake module parameters that MilkFlint's
// features/tuning/bin/cake-shaper writes from milkflint options (when they
// change, and after sqm sets up a queue), and one of ifb's, which
// /usr/libexec/milkflint/ifb-direct writes the same way. Unset is off, as
// upstream:
// - cake.drop_one_segment "1": when CAKE drops from a grouped (GRO) packet
//   it takes whole, one packet of it rather than the whole group
//   (drop_one_segment); only with no-split-gso, and only for fraglist GRO
//   packets: a plain GRO packet has no separate packets to take one from,
//   and Automatic GRO is plain GRO whenever CAKE takes groups whole;
// - cake.sparse_ahead: how far ahead of the shaper a new flow's packet may
//   go on a download, 1 to 1000 µs (sparse_ahead_us); anything else off;
// - cake.ifb_direct "1": the download's ifb hands what CAKE lets through
//   back to the router straight from CAKE's dequeue, when nothing is queued
//   ahead, rather than from a tasklet a softirq later (ifb's direct_xmit);
//   only under CAKE.
// No imports from the app, so the tests (ui/tests) load it as it is.

export interface CakeExtras {
  dropOneSegment: boolean;
  /** µs as text; '' off */
  sparseAhead: string;
  /** ifb hands a shaped download back straight from CAKE's dequeue */
  ifbDirect: boolean;
}

export const cakeExtrasDefaults: CakeExtras = { dropOneSegment: false, sparseAhead: '', ifbDirect: false };

/** The furthest ahead cake-shaper lets a packet go, µs */
export const SPARSE_AHEAD_MAX = 1000;

/** How far ahead the sheet offers: '' is off, the default */
export const sparseAheadChoices = ['', '100', '250', '500'];

/** The settings as cake-shaper and ifb-direct read them: whatever they would ignore is off. */
export function cakeExtrasOf(
  dropOneSegment: string | undefined,
  sparseAhead: string | undefined,
  ifbDirect?: string,
): CakeExtras {
  let ahead = '';
  if (sparseAhead !== undefined && /^\d{1,4}$/.test(sparseAhead)) {
    const n = Number(sparseAhead);
    if (n > 0 && n <= SPARSE_AHEAD_MAX) ahead = String(n);
  }
  return { dropOneSegment: dropOneSegment === '1', sparseAhead: ahead, ifbDirect: ifbDirect === '1' };
}

/** milkflint.cake's options for the settings; undefined is unset, off */
export function cakeExtrasOptions(e: CakeExtras): {
  drop_one_segment: string | undefined;
  sparse_ahead: string | undefined;
  ifb_direct: string | undefined;
} {
  return {
    drop_one_segment: e.dropOneSegment ? '1' : undefined,
    sparse_ahead: e.sparseAhead === '' ? undefined : e.sparseAhead,
    ifb_direct: e.ifbDirect ? '1' : undefined,
  };
}

/** "Off (default)", "Up to 250 µs ahead" */
export function sparseAheadLabel(value: string | number): string {
  const us = value === '' ? 0 : Number(value);
  return us === 0 ? 'Off (default)' : `Up to ${String(us)} µs ahead`;
}

/** What sch_cake and ifb have now for the sheet: their parameters (null without one), and whether each is loaded at all */
export interface CakeExtrasLive {
  dropOneSegment: boolean | null;
  sparseAhead: number | null;
  /** packets dropped one of a group since sch_cake loaded (one_segment_drops); null without the counter */
  oneSegmentDrops: number | null;
  /** sch_cake is loaded */
  loaded: boolean;
  /** ifb's direct_xmit; null without it, or with ifb not loaded */
  ifbDirect: boolean | null;
  /** ifb is loaded (sqm loads it for a download it shapes) */
  ifbLoaded: boolean;
}

/**
 * Whether the internet port groups with fraglist GRO now, from the GRO
 * ports Performance Tuning's status reports (`now.list`): true if one does,
 * false if none can (no port, or each says plain); undefined while it isn't
 * known (not read yet, or ethtool didn't say)
 */
export function fraglistNow(ports: readonly { now: { list: boolean | null } }[] | undefined): boolean | undefined {
  if (ports === undefined) return undefined;
  if (ports.some((p) => p.now.list === true)) return true;
  return ports.some((p) => p.now.list === null) ? undefined : false;
}

/**
 * Why dropping one packet of a group does nothing now, one line each: CAKE
 * splits grouped packets up (whole false), or the internet port doesn't
 * group with fraglist (fraglist false; undefined isn't known, so not said)
 */
export function dropOneSegmentIdle(whole: boolean, fraglist: boolean | undefined): string[] {
  const out: string[] = [];
  if (!whole)
    out.push(
      'CAKE splits grouped packets up at this setting and speed, so there are no groups to drop from (Grouped packets, above).',
    );
  if (fraglist === false)
    out.push(
      'The internet port isn’t grouping with fraglist now, so this does nothing: change Receive grouping on Performance Tuning.',
    );
  return out;
}

/** What dropping one packet of a group has done, while it's on or once it has dropped any; undefined otherwise or without the counter */
export function oneSegmentDropsNow(on: boolean, live: CakeExtrasLive | undefined): string | undefined {
  const n = live?.oneSegmentDrops;
  if (n === null || n === undefined || (!on && n === 0)) return undefined;
  return `Dropped this way since Smart Queue started: ${n.toLocaleString('en')} packet${n === 1 ? '' : 's'}.`;
}

/** A parameter sch_cake is loaded without: this image doesn't have it */
export function cakeParamMissing(value: unknown, live: CakeExtrasLive | undefined): boolean {
  return live !== undefined && live.loaded && value === null;
}

/** ifb loaded without direct_xmit: this image doesn't have it */
export function ifbParamMissing(live: CakeExtrasLive | undefined): boolean {
  return live !== undefined && live.ifbLoaded && live.ifbDirect === null;
}

/** An on/off parameter that differs from what's saved: what it is now */
function onOffNow(saved: boolean, now: boolean | null | undefined): string | undefined {
  if (now === null || now === undefined) return undefined;
  return now === saved ? undefined : `In use now: ${now ? 'on' : 'off'}.`;
}

/**
 * When sch_cake (or ifb) has something other than what's saved, what it has:
 * undefined while they agree, or when it isn't known
 */
export function dropOneSegmentNow(saved: boolean, live: CakeExtrasLive | undefined): string | undefined {
  return onOffNow(saved, live?.dropOneSegment);
}

export function ifbDirectNow(saved: boolean, live: CakeExtrasLive | undefined): string | undefined {
  return onOffNow(saved, live?.ifbDirect);
}

export function sparseAheadNow(saved: string, live: CakeExtrasLive | undefined): string | undefined {
  if (live === undefined || live.sparseAhead === null) return undefined;
  const want = saved === '' ? 0 : Number(saved);
  if (live.sparseAhead === want) return undefined;
  return `In use now: ${live.sparseAhead === 0 ? 'off' : `up to ${String(live.sparseAhead)} µs ahead`}.`;
}
