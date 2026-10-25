// The save flow every settings page uses: stage the changes, apply them with
// rollback armed, then confirm from the browser. If the router can't be
// reached within ROLLBACK_SECONDS (say the change cut off the connection),
// it undoes the change by itself; a page that knows its change keeps the
// browser's Wi-Fi off for longer (a radar check) asks for more time. A firewall change nft won't load is undone
// at once, rather than kept for the next reload or boot to fail on.
import { useCallback, useState } from 'react';
import { applyUnchecked, applyWithRollback, type Change, confirm, firewallError, rollback, stage } from '@/lib/api/uci';
import { errorMessage } from '@/lib/utils';

export const ROLLBACK_SECONDS = 60;
const HOLDOFF_MS = 3000;

export type ApplyState =
  | { phase: 'idle' }
  | { phase: 'applying'; deadline: number; note?: string | undefined }
  | { phase: 'done'; nothingChanged: boolean }
  | { phase: 'moved'; url: string }
  | { phase: 'rolled-back' }
  | { phase: 'failed'; message: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

/** What nft finds wrong with the firewall config; undefined when it loads, or when the check can't run. */
async function firewallFault(): Promise<string | undefined> {
  try {
    return await firewallError();
  } catch {
    return undefined;
  }
}

/**
 * For a change that keeps the browser's way to the router down for a known
 * while (a radar check on the Wi-Fi it uses): how long to wait before
 * undoing it, and what the page says meanwhile.
 */
export interface ApplyOptions {
  timeoutSeconds?: number;
  note?: string;
}

export function useApply(onApplied?: () => void): {
  state: ApplyState;
  apply: (changes: readonly Change[], options?: ApplyOptions) => Promise<void>;
  applyAndMove: (changes: readonly Change[], newUrl: string) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });

  const apply = useCallback(
    async (changes: readonly Change[], options?: ApplyOptions): Promise<void> => {
      try {
        // a firewall that already fails its check isn't this change's doing: then only the timer guards
        const checkFirewall = changes.some((c) => c.config === 'firewall') && (await firewallFault()) === undefined;
        await stage(changes);
        const timeout = Math.max(ROLLBACK_SECONDS, Math.ceil(options?.timeoutSeconds ?? 0));
        const deadline = Date.now() + timeout * 1000;
        if (!(await applyWithRollback(timeout))) {
          setState({ phase: 'done', nothingChanged: true });
          return;
        }
        setState({ phase: 'applying', deadline, note: options?.note });
        const fault = checkFirewall ? await firewallFault() : undefined;
        if (fault !== undefined) {
          await rollback();
          setState({ phase: 'failed', message: `The firewall couldn’t load this (${fault}), so it was undone.` });
          return;
        }
        await sleep(HOLDOFF_MS);
        while (Date.now() < deadline - 2000) {
          try {
            await confirm();
            setState({ phase: 'done', nothingChanged: false });
            onApplied?.();
            return;
          } catch {
            await sleep(1500);
          }
        }
        setState({ phase: 'rolled-back' });
      } catch (err) {
        setState({ phase: 'failed', message: errorMessage(err) });
      }
    },
    [onApplied],
  );

  // Changes that move the router (new LAN address): nothing to confirm from
  // here, so no rollback; the user continues at the new address.
  const applyAndMove = useCallback(async (changes: readonly Change[], newUrl: string): Promise<void> => {
    try {
      await stage(changes);
      await applyUnchecked();
      setState({ phase: 'moved', url: newUrl });
    } catch (err) {
      setState({ phase: 'failed', message: errorMessage(err) });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

  return { state, apply, applyAndMove, reset };
}
