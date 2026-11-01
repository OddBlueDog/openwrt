// The save flow every settings page uses: stage the changes and apply them
// at once, as LuCI's "Apply unchecked" does: no timer that undoes a change
// the browser can't confirm, so a new Wi-Fi name or password stays however
// long devices take to rejoin. A firewall change is the exception: it's
// applied with rollback armed, and undone at once if nft won't load it,
// rather than kept for the next reload or boot to fail on; otherwise it's
// kept straight away.
import { useCallback, useState } from 'react';
import { applyUnchecked, applyWithRollback, type Change, confirm, firewallError, rollback, stage } from '@/lib/api/uci';
import { errorMessage } from '@/lib/utils';

/** How long rpcd keeps a firewall change's rollback armed while nft checks it. */
const FIREWALL_ROLLBACK_SECONDS = 60;

export type ApplyState =
  | { phase: 'idle' }
  | { phase: 'applying' }
  | { phase: 'done'; nothingChanged: boolean; note?: string | undefined }
  | { phase: 'moved'; url: string }
  | { phase: 'failed'; message: string };

/** What nft finds wrong with the firewall config; undefined when it loads, or when the check can't run. */
async function firewallFault(): Promise<string | undefined> {
  try {
    return await firewallError();
  } catch {
    return undefined;
  }
}

/** For a change with something worth saying once it's applied (a radar check that keeps a network off for a while). */
export interface ApplyOptions {
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
      setState({ phase: 'applying' });
      try {
        // a firewall that already fails its check isn't this change's doing: then it's applied like the rest
        const checkFirewall = changes.some((c) => c.config === 'firewall') && (await firewallFault()) === undefined;
        await stage(changes);
        const applied = checkFirewall ? await applyWithRollback(FIREWALL_ROLLBACK_SECONDS) : await applyUnchecked();
        if (!applied) {
          setState({ phase: 'done', nothingChanged: true });
          return;
        }
        if (checkFirewall) {
          const fault = await firewallFault();
          if (fault !== undefined) {
            await rollback();
            setState({ phase: 'failed', message: `The firewall couldn’t load this (${fault}), so it was undone.` });
            return;
          }
          await confirm();
        }
        setState({ phase: 'done', nothingChanged: false, note: options?.note });
        onApplied?.();
      } catch (err) {
        setState({ phase: 'failed', message: errorMessage(err) });
      }
    },
    [onApplied],
  );

  // Changes that move the router (new LAN address): the user continues at
  // the new address.
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
