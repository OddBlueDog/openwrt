// Pieces both VPN pages use: a line of what a setting does (a tick or a
// cross), the data a tunnel has carried each way, an answer cell, and what
// shows when the image has no WireGuard.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, PackageXIcon, XIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CheckItem({ yes, children }: { yes: boolean; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          yes ? 'bg-success-subtle text-success' : 'bg-destructive-subtle text-destructive',
        )}
      >
        {yes ? <CheckIcon className="size-3" aria-label="Yes" /> : <XIcon className="size-3" aria-label="No" />}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** What a tunnel carried, down and up, with drawn arrows and words for screen readers. */
export function Traffic({ down, up }: { down: number; up: number }): ReactElement {
  return (
    <span className="inline-flex items-center gap-2 tabular">
      <span className="inline-flex items-center gap-0.5">
        <ArrowDownIcon className="size-3.5" aria-hidden />
        <span className="sr-only">Down </span>
        {formatBytes(down)}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <ArrowUpIcon className="size-3.5" aria-hidden />
        <span className="sr-only">Up </span>
        {formatBytes(up)}
      </span>
    </span>
  );
}

/** One part of a page's opening answer: what it's about, its state, a line or two. */
export function Cell({ title, status, children }: { title: string; status: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="flex min-h-6 min-w-0 items-center">{status}</div>
      {children !== undefined && <div className="flex flex-col gap-1.5 text-sm text-foreground">{children}</div>}
    </div>
  );
}

export function NoWireGuard(): ReactElement {
  return (
    <Alert>
      <PackageXIcon />
      <AlertTitle>WireGuard isn’t installed</AlertTitle>
      <AlertDescription>
        <p>
          This router’s image has no WireGuard (kmod-wireguard and wireguard-tools), or not the VPN pages’ part of the web
          interface. MilkFlint’s releases include both: upgrade to get them.
        </p>
        <Button size="sm" className="mt-2" asChild>
          <Link {...pageLink('upgrade')}>
            Upgrade <ChevronRightIcon />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
