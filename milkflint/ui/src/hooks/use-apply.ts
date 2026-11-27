// The save flow every settings page uses (applyChanges in lib/api/uci.ts
// says what a save does), as a mutation: saves run one at a time across the
// whole app (rpcd stages per session, so two interleaved would mix their
// changes), and once one is applied every query is refreshed, so the page
// shows what the router now has without asking.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { applyChanges, applyUnchecked, type Change, stage } from '@/lib/api/uci';
import { errorMessage } from '@/lib/utils';

export type ApplyState =
  | { phase: 'idle' }
  | { phase: 'applying' }
  | { phase: 'done'; nothingChanged: boolean; note?: string | undefined; title?: string | undefined }
  | { phase: 'moved'; url: string }
  | { phase: 'failed'; message: string; title?: string | undefined };

/** For a change with something worth saying once it's applied (a radar check that keeps a network off for a while). */
export interface ApplyOptions {
  note?: string;
}

/** Every UCI save shares this scope: one runs after the other, never interleaved. */
const APPLY_SCOPE = { id: 'uci-apply' };

/**
 * How long a save waits for the pages' reads to come back before it's done.
 * They usually do well within it; a router out of reach just after the save
 * (a new Wi-Fi password, a web server restart) mustn't keep it "Applying…"
 * and the next save waiting. The reads go on after it.
 */
export const REFRESH_WAIT_MS = 2000;

/** `promise`, or after `ms` whatever it's doing by then. */
async function within(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function useApply(onApplied?: () => void): {
  state: ApplyState;
  /** resolves with how it ended (done or failed), for a sheet that closes only once its save went through */
  apply: (changes: readonly Change[], options?: ApplyOptions) => Promise<ApplyState>;
  applyAndMove: (changes: readonly Change[], newUrl: string) => Promise<void>;
  reset: () => void;
} {
  const client = useQueryClient();
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  const { mutateAsync: save } = useMutation({
    scope: APPLY_SCOPE,
    mutationFn: applyChanges,
    // part of the save: the next one waits until the pages have what this one wrote (or REFRESH_WAIT_MS)
    onSuccess: async ({ nothingChanged }) => {
      if (!nothingChanged) await within(client.invalidateQueries(), REFRESH_WAIT_MS);
    },
  });
  const { mutateAsync: move } = useMutation({
    scope: APPLY_SCOPE,
    mutationFn: async (changes: readonly Change[]) => {
      await stage(changes);
      await applyUnchecked();
    },
  });

  const apply = useCallback(
    async (changes: readonly Change[], options?: ApplyOptions): Promise<ApplyState> => {
      setState({ phase: 'applying' });
      let end: ApplyState;
      try {
        const { nothingChanged } = await save(changes);
        end = { phase: 'done', nothingChanged, note: nothingChanged ? undefined : options?.note };
        setState(end);
        if (!nothingChanged) onApplied?.();
      } catch (err) {
        end = { phase: 'failed', message: errorMessage(err) };
        setState(end);
      }
      return end;
    },
    [save, onApplied],
  );

  // Changes that move the router (new LAN address): the user continues at
  // the new address.
  const applyAndMove = useCallback(
    async (changes: readonly Change[], newUrl: string): Promise<void> => {
      try {
        await move(changes);
        setState({ phase: 'moved', url: newUrl });
      } catch (err) {
        setState({ phase: 'failed', message: errorMessage(err) });
      }
    },
    [move],
  );

  const reset = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

  return { state, apply, applyAndMove, reset };
}
