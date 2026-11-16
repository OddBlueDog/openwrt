// The save bar with what the save will do above it, for a save with
// consequences: on the Wi-Fi pages, which band's devices drop, have to join
// again or lose Wi-Fi, this browser's device among them if it's on that band.
// `confirm` asks first when the save may cut this device off.
import { TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface SaveConfirm {
  title: string;
  description: string;
  action: string;
}

export function SaveArea({
  visible,
  busy,
  invalid,
  warnings,
  warningTitle = 'Saving disconnects devices',
  confirm,
  onSave,
  onRevert,
}: {
  visible: boolean;
  busy: boolean;
  invalid: boolean;
  /** What the save does, a sentence each; none: nothing to warn about */
  warnings: readonly string[];
  /** The warning's heading */
  warningTitle?: string;
  /** Asked before saving, when the save may cut this device off */
  confirm: SaveConfirm | undefined;
  onSave: () => void;
  onRevert: () => void;
}): ReactElement | null {
  const [asking, setAsking] = useState(false);
  if (!visible && !busy) return null;
  return (
    // the bar keeps its own place at the bottom; the warning rides above it
    <div className="sticky bottom-4 z-20 mt-6 flex flex-col gap-2 *:mt-0">
      {warnings.length > 0 && !busy && (
        <div
          role="status"
          className="flex animate-[mf-pop-in_var(--mf-duration-base)_var(--mf-ease-enter)] items-start gap-3 rounded-xl border border-warning/30 bg-warning-subtle px-4 py-3 text-sm shadow-lg"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">{warningTitle}</p>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <SaveBar
        visible={visible}
        busy={busy}
        invalid={invalid}
        onSave={() => {
          if (confirm === undefined) onSave();
          else setAsking(true);
        }}
        onRevert={onRevert}
      />
      <Dialog open={asking && confirm !== undefined} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setAsking(false);
                onSave();
              }}
            >
              {confirm?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
