// The bench's state in words, for the answer on top of the page: who has
// joined and whether they're ready, and where a run is. Each state comes
// with the status badge it shows as (a word and a dot, never colour alone).
import type { Member, Run } from './api';

export type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export interface StatusWord {
  text: string;
  tone: Tone;
}

/** A member not heard from for this long is away (its page closed, or the phone locked). */
export const AWAY_MS = 15_000;

export type Presence = 'ready' | 'away' | 'hidden';

export function presence(m: Pick<Member, 'seen_ms' | 'visible'>): Presence {
  if (m.seen_ms > AWAY_MS) return 'away';
  if (m.visible === false) return 'hidden';
  return 'ready';
}

/** How many devices have joined, and how many of them can take part now. */
export function devicesStatus(
  members: readonly Pick<Member, 'seen_ms' | 'visible'>[],
): StatusWord & { ready: number; total: number } {
  const total = members.length;
  const ready = members.filter((m) => presence(m) === 'ready').length;
  if (total === 0) return { text: 'None yet', tone: 'outline', ready, total };
  if (ready === total) return { text: total === 1 ? 'Ready' : `All ${String(total)} ready`, tone: 'success', ready, total };
  const out = total - ready;
  return { text: total === 1 ? 'Not ready' : `${String(out)} of ${String(total)} not ready`, tone: 'warning', ready, total };
}

/** A run's state as a status word; no run: none. */
export function runStatus(run: Pick<Run, 'state' | 'ended'> | null | undefined): StatusWord {
  if (run === undefined || run === null) return { text: 'Nothing running', tone: 'outline' };
  switch (run.state) {
    case 'scheduled':
      return { text: 'Starting', tone: 'info' };
    case 'running':
      return { text: 'Running', tone: 'success' };
    case 'stopping':
      return { text: 'Stopping', tone: 'warning' };
    case 'collecting':
      return { text: 'Collecting results', tone: 'info' };
    case 'done':
      return run.ended === undefined || run.ended === null || run.ended.reason === 'completed'
        ? { text: 'Finished', tone: 'success' }
        : { text: 'Ended early', tone: 'warning' };
  }
}

/** Whether a run is under way: no new one can start, and the page keeps the screen on. */
export function runOn(run: Pick<Run, 'state'> | null | undefined): boolean {
  return run?.state === 'scheduled' || run?.state === 'running' || run?.state === 'stopping';
}

/** "Mac, iPhone and PC"; past `max` names, "Mac, iPhone, PC and 2 more". */
export function namesText(names: readonly string[], max = 4): string {
  const shown = names.length > max ? [...names.slice(0, max - 1), `${String(names.length - max + 1)} more`] : [...names];
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(shown);
}

/** Each device's name by its id, a name two share with the id after it ("Mac (m3)"): a matrix's columns, which must differ. */
export function distinctNames(members: readonly { id: string; name: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const m of members) seen.set(m.name, (seen.get(m.name) ?? 0) + 1);
  return new Map(members.map((m) => [m.id, (seen.get(m.name) ?? 0) > 1 ? `${m.name} (${m.id})` : m.name]));
}
