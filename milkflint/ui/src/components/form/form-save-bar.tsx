// The save bar for a settings form: shown while the values differ from the
// saved settings (or a save is on its way), Save disabled while an error
// shows. The bar itself is SaveBar's.
import type { ReactElement, ReactNode } from 'react';
import { SaveBar } from '@/components/save-bar';

export function FormSaveBar({
  settings,
  busy,
  extra,
}: {
  settings: { dirty: boolean; invalid: boolean; save: () => void; discard: () => void };
  busy: boolean;
  /** another way to save, beside Save */
  extra?: ReactNode;
}): ReactElement | null {
  return (
    <SaveBar
      visible={settings.dirty}
      busy={busy}
      invalid={settings.dirty && settings.invalid}
      onSave={settings.save}
      onRevert={settings.discard}
      extra={extra}
    />
  );
}
