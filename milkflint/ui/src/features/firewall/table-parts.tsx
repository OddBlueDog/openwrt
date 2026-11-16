// What the Firewall and Port forwards pages' tables share (rules, port
// forwards, zones, NAT): the grouped table frame, its group headers, the
// small cells, and the on/off switch each row has.
import { ArrowRightIcon, type LucideIcon, RouterIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { FeatureId } from '../ids';

export function RouterPill(): ReactElement {
  return (
    <span className="rounded inline-flex items-center gap-1 border border-primary/30 bg-primary-subtle px-1.5 py-px text-xs text-primary-subtle-foreground">
      <RouterIcon className="size-3" /> router
    </span>
  );
}

/** An icon and a name or address, cut short when long (whole in its tooltip); `mono` for an address, a MAC address or a zone, not a device's name. */
export function Who({
  icon: Icon,
  children,
  title,
  mono = false,
}: {
  icon: LucideIcon;
  children: ReactNode;
  title?: string | undefined;
  mono?: boolean;
}): ReactElement {
  return (
    <span className="inline-flex max-w-44 min-w-0 items-center gap-1.5 truncate" title={title}>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn('truncate text-xs', mono && 'font-mono')}>{children}</span>
    </span>
  );
}

/**
 * fw4's word for what happens (accept, reject, drop, dnat…), coloured by
 * whether it lets things through; neutral while the row is off, so a rule
 * that does nothing doesn't look as if it lets things through.
 */
export function VerdictBadge({ verdict, off = false }: { verdict: string; off?: boolean }): ReactElement {
  const v = verdict.toLowerCase();
  return (
    <Badge
      variant={off ? 'secondary' : v === 'accept' ? 'success' : v === 'reject' || v === 'drop' ? 'destructive' : 'secondary'}
      className="font-normal"
    >
      {v}
    </Badge>
  );
}

/** "Off" in words beside a row's name: the row's state never rests on colour or the switch alone. */
export function OffBadge(): ReactElement {
  return (
    <Badge variant="outline" className="h-5 px-2 font-normal">
      Off
    </Badge>
  );
}

/** Who made a row: OpenWrt (its standard rules) or another MilkFlint page (a link to it). */
export function OriginMark({ origin }: { origin: 'openwrt' | { page: FeatureId; title: string } }): ReactElement {
  if (origin === 'openwrt') {
    return (
      <Badge variant="secondary" className="h-5 px-2 font-normal" title="One of OpenWrt’s standard rules">
        OpenWrt
      </Badge>
    );
  }
  return (
    <a
      href={href(origin.page)}
      className="inline-flex h-5 items-center rounded-full bg-primary-subtle px-2 text-xs whitespace-nowrap text-primary-subtle-foreground underline-offset-4 hover:underline"
      title={`Made by the ${origin.title} page`}
    >
      {origin.title}
    </a>
  );
}

/** "Internet → Router", with the arrow read out as "to". */
export function Path({ from, to }: { from: ReactNode; to: ReactNode }): ReactElement {
  return (
    <>
      <span className="font-medium">{from}</span>
      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
      <span className="font-medium">{to}</span>
    </>
  );
}

/** A group's header: its title and size on the left, an action on the right; a table row when it has columns to span. */
export function GroupHeader({
  title,
  count,
  noun,
  action,
  colSpan,
}: {
  title: ReactNode;
  /** how many it holds, with its noun singular and plural; left out for a group of one kind */
  count?: number;
  noun?: readonly [string, string];
  action?: ReactNode;
  colSpan?: number;
}): ReactElement {
  const content = (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        {title}
        {count !== undefined && noun !== undefined && (
          <span className="text-xs text-muted-foreground">
            · {count} {count === 1 ? noun[0] : noun[1]}
          </span>
        )}
      </span>
      {action}
    </div>
  );
  return colSpan === undefined ? (
    <div className="border-y bg-muted/60 px-4 py-1.5">{content}</div>
  ) : (
    <tr>
      <th scope="colgroup" colSpan={colSpan} className="border-y bg-muted/60 px-3 py-1.5 text-left font-normal">
        {content}
      </th>
    </tr>
  );
}

/** A small action in a group header, like "Add rule". */
export function HeaderButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** The table's column headings. */
export function HeadRow({
  columns,
}: {
  columns: readonly { label: string; className?: string; hidden?: boolean }[];
}): ReactElement {
  return (
    <tr className="text-left text-xs text-muted-foreground">
      {columns.map((c) => (
        <th key={c.label} scope="col" className={cn('h-9 px-3 font-medium whitespace-nowrap', c.className)}>
          {c.hidden === true ? <span className="sr-only">{c.label}</span> : c.label}
        </th>
      ))}
    </tr>
  );
}

/** On or off, as a switch named after its row. While a save is applying it's locked (dashed), which reads apart from off. */
export function OnSwitch({
  on,
  name,
  disabled,
  onToggle,
}: {
  on: boolean;
  name: string;
  disabled: boolean;
  onToggle: () => void;
}): ReactElement {
  return <Switch checked={on} aria-label={`${name} on`} disabled={disabled} onCheckedChange={onToggle} />;
}

/** A row's icon action (edit, delete). */
export function RowButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}
