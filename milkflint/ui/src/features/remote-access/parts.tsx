// Pieces both VPN pages use: a line of what a setting does (✓ or ✗), what
// the last save changed, and the card shown when the image has no WireGuard.
import { CheckIcon, ListChecksIcon, PackageXIcon, XIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function CheckItem({ yes, children }: { yes: boolean; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          yes ? 'bg-success/15 text-success' : 'bg-destructive/12 text-destructive',
        )}
      >
        {yes ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** What the last save did, in words, under "Saved and applied". */
export function AppliedCard({ lines }: { lines: readonly string[] }): ReactElement {
  return (
    <Card>
      <CardHeading icon={ListChecksIcon} title="What was applied" />
      <CardContent>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function NoWireGuard(): ReactElement {
  return (
    <Card>
      <CardHeading
        icon={PackageXIcon}
        title="WireGuard isn’t installed"
        description="This router’s image has no WireGuard (kmod-wireguard and wireguard-tools), or not the VPN pages’ part of the web interface. MilkFlint images from this version on include both."
      />
    </Card>
  );
}
