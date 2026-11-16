// What fw4's own check says it leaves out of the firewall (so it does
// nothing): shown on the Firewall and Port forwards pages, both of which
// edit what it checks.
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function CheckWarnings({ warnings }: { warnings: readonly string[] | undefined }): ReactElement | null {
  if (warnings === undefined || warnings.length === 0) return null;
  // fw4 can say several things about one section: count the sections
  const sections = new Set(warnings.map((w) => /^Section (\S+)/.exec(w)?.[1] ?? w)).size;
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>
        {sections === 1
          ? 'The firewall skips a setting it can’t use'
          : `The firewall skips ${String(sections)} settings it can’t use`}
      </AlertTitle>
      <AlertDescription>
        OpenWrt’s firewall leaves these out, so they do nothing. Edit or delete them here or in LuCI. What it says:
        <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs break-words">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
