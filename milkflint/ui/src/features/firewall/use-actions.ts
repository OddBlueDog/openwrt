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
  | { kind: 'block'; rule: Rule | undefined }
  | { kind: 'nat'; nat: NatRule | undefined }
  | { kind: 'confirm'; title: string; body: string; action: string; changes: Change[] };

export function useFirewallActions(onApplied: () => void): {
  state: ApplyState;
  actions: Actions;
  dialog: OpenDialog | undefined;
  setDialog: (d: OpenDialog | undefined) => void;
  /** close the dialog and apply what it saved */
  save: (changes: Change[]) => void;
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
        setDialog({ kind: 'block', rule: undefined });
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

  return { state, actions, dialog, setDialog, save };
}
