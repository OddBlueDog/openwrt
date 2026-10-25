import type { ReactElement } from 'react';
import type { Change } from '@/lib/api/uci';
import type { FirewallData } from './api';
import { BlockDialog } from './blocks';
import { ForwardDialog } from './forwards';
import { NatDialog } from './nat';
import { ConfirmDialog } from './parts';
import { RuleSheet } from './rule-sheet';
import type { OpenDialog } from './use-actions';

/** Whichever of the Firewall page's dialogs is open. */
export function FirewallDialogs({
  dialog,
  data,
  onClose,
  onSave,
}: {
  dialog: OpenDialog | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement | null {
  switch (dialog?.kind) {
    case undefined:
      return null;
    case 'forward':
      return <ForwardDialog forward={dialog.forward} data={data} onClose={onClose} onSave={onSave} />;
    case 'rule':
      return <RuleSheet rule={dialog.rule} preset={dialog.preset} data={data} onClose={onClose} onSave={onSave} />;
    case 'block':
      return <BlockDialog rule={dialog.rule} data={data} onClose={onClose} onSave={onSave} />;
    case 'nat':
      return <NatDialog nat={dialog.nat} data={data} onClose={onClose} onSave={onSave} />;
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
