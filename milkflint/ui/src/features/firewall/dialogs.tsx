import type { ReactElement } from 'react';
import type { Change } from '@/lib/api/uci';
import { ForwardSheet } from '../port-forwards/forward-sheet';
import type { FirewallData } from './api';
import { BlockSheet } from './blocks';
import type { Actions } from './forms';
import { managerOf } from './model';
import { NatSheet } from './nat';
import { ConfirmDialog } from './parts';
import { RuleSheet } from './rule-sheet';
import type { OpenDialog } from './use-actions';

const deleteChange = (section: string): Change[] => [{ op: 'delete', config: 'firewall', section }];

/** Whichever of the Firewall and Port forwards pages' editors (side sheets) or confirmations is open. */
export function FirewallDialogs({
  dialog,
  data,
  onClose,
  onSave,
  confirm,
}: {
  dialog: OpenDialog | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
  /** ask before a delete (it replaces the open sheet) */
  confirm: Actions['confirm'];
}): ReactElement | null {
  switch (dialog?.kind) {
    case undefined:
      return null;
    case 'forward': {
      const r = dialog.forward;
      return (
        <ForwardSheet
          forward={r}
          data={data}
          onClose={onClose}
          onSave={onSave}
          onDelete={
            r === undefined
              ? undefined
              : () => {
                  confirm({
                    title: `Delete ${r.name ?? r.label}?`,
                    body: 'The port closes and the forward is gone; turning it off keeps it for later.',
                    action: 'Delete',
                    changes: deleteChange(r.section),
                  });
                }
          }
        />
      );
    }
    case 'rule': {
      const r = dialog.rule;
      return (
        <RuleSheet
          rule={r}
          preset={dialog.preset}
          data={data}
          onClose={onClose}
          onSave={onSave}
          onDelete={
            r === undefined
              ? undefined
              : () => {
                  const managed = managerOf(r.section);
                  confirm({
                    title: `Delete ${r.name ?? r.label}?`,
                    body:
                      managed === undefined
                        ? 'The rule is gone for good; turning it off keeps it for later.'
                        : `The ${managed.title} page made it, and adds it back when you next save there. Turning it off keeps it for later.`,
                    action: 'Delete',
                    changes: deleteChange(r.section),
                  });
                }
          }
        />
      );
    }
    case 'block':
      return <BlockSheet data={data} onClose={onClose} onSave={onSave} />;
    case 'nat': {
      const r = dialog.nat;
      return (
        <NatSheet
          nat={r}
          data={data}
          onClose={onClose}
          onSave={onSave}
          onDelete={
            r === undefined
              ? undefined
              : () => {
                  confirm({
                    title: `Delete ${r.name ?? r.label}?`,
                    body: 'The NAT rule is gone for good; turning it off keeps it for later.',
                    action: 'Delete',
                    changes: deleteChange(r.section),
                  });
                }
          }
        />
      );
    }
    case 'confirm':
      return (
        <ConfirmDialog
          title={dialog.title}
          action={dialog.action}
          onClose={onClose}
          onConfirm={() => {
            onSave(dialog.changes);
          }}
        >
          <span>{dialog.body}</span>
        </ConfirmDialog>
      );
  }
}
