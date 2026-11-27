// The Firewall page's save flow and open dialog: every change goes through
// useApply (staged, applied with rollback armed, confirmed from the browser;
// fw4 reloads its ruleset).
import { useCallback, useMemo, useRef, useState } from 'react';
import { type ApplyState, useApply } from '@/hooks/use-apply';
import type { Change } from '@/lib/api/uci';
import type { Actions, RulePreset } from './forms';
import type { NatRule, Redirect, Rule } from './model';

export type OpenDialog =
  | { kind: 'forward'; forward: Redirect | undefined }
  | { kind: 'rule'; rule: Rule | undefined; preset: RulePreset | undefined }
  | { kind: 'block' }
  | { kind: 'nat'; nat: NatRule | undefined }
  | { kind: 'confirm'; title: string; body: string; action: string; changes: Change[] };

export function useFirewallActions(onApplied: () => void): {
  state: ApplyState;
  actions: Actions;
  dialog: OpenDialog | undefined;
  setDialog: (d: OpenDialog | undefined) => void;
  /** close the dialog and apply what it saved */
  save: (changes: Change[]) => void;
  /** apply what a sheet saved, closing it once that went through; the failure's message when it didn't */
  submit: (changes: Change[]) => Promise<string | undefined>;
  /** apply what a sheet of the page's own (the zones tab's) saved; the failure's message when it didn't go through */
  applyNow: (changes: Change[]) => Promise<string | undefined>;
} {
  const done = useRef<(() => void) | undefined>(undefined);
  const applied = useCallback(() => {
    done.current?.();
    done.current = undefined;
    onApplied();
  }, [onApplied]);
  const { state, apply } = useApply(applied);
  const [dialog, setDialog] = useState<OpenDialog>();
  const applying = state.phase === 'applying';

  const actions = useMemo(
    (): Actions => ({
      applying,
      apply: (changes, onDone) => {
        done.current = onDone;
        void apply(changes);
      },
      editForward: (forward) => {
        setDialog({ kind: 'forward', forward });
      },
      editRule: (rule, preset) => {
        setDialog({ kind: 'rule', rule, preset });
      },
      editNat: (nat) => {
        setDialog({ kind: 'nat', nat });
      },
      blockDevice: () => {
        setDialog({ kind: 'block' });
      },
      confirm: (c) => {
        setDialog({ kind: 'confirm', ...c });
      },
    }),
    [applying, apply],
  );

  const save = useCallback(
    (changes: Change[]) => {
      setDialog(undefined);
      done.current = undefined;
      void apply(changes);
    },
    [apply],
  );

  const applyNow = useCallback(
    async (changes: Change[]): Promise<string | undefined> => {
      done.current = undefined;
      const end = await apply(changes);
      return end.phase === 'failed' ? end.message : undefined;
    },
    [apply],
  );

  const submit = useCallback(
    async (changes: Change[]): Promise<string | undefined> => {
      const failed = await applyNow(changes);
      if (failed === undefined) setDialog(undefined);
      return failed;
    },
    [applyNow],
  );

  return { state, actions, dialog, setDialog, save, submit, applyNow };
}
