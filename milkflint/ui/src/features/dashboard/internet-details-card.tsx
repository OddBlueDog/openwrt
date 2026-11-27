// The internet connection in detail: what it carries now (against Smart
// Queue's limits while it shapes), the router's addresses on it, how long
// it's been connected and how. In access point mode, the link to the main
// router instead.
import { Link } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { ipv4, wanIpv6 } from '@/lib/api/network';
import { formatBitrate, formatDuration } from '@/lib/format';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { wanBehindNat } from '../firewall/api';
import type { Dashboard } from './use-dashboard';
import { StateBadge, Way, Widget, WidgetLink } from './widget';
import { useWidgetInfo } from './widget-info';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    // a value with no room beside its label goes under it, whole (an IPv6 address may still break, being long)
    // one narrow column: the value under its label, from the left
    <div
      data-fit
      className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5 text-sm narrow:flex-col narrow:items-start"
    >
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="ml-auto min-w-0 text-right font-medium break-words tabular narrow:ml-0 narrow:text-left">{children}</dd>
    </div>
  );
}

function Rate({ dir, rate, limit }: { dir: 'down' | 'up'; rate: number | undefined; limit: number | undefined }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      {/* in one column the figures go under the label, each whole */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="whitespace-nowrap text-muted-foreground">
          <Way dir={dir} /> {dir === 'down' ? 'Download' : 'Upload'} now
        </span>
        <span className="ml-auto font-medium whitespace-nowrap tabular narrow:ml-0">
          {rate === undefined ? '—' : formatBitrate(rate)}
          {limit !== undefined && <span className="font-normal text-muted-foreground"> of {formatBitrate(limit)}</span>}
        </span>
      </div>
      {limit !== undefined && (
        <Progress
          value={rate === undefined ? 0 : (rate / limit) * 100}
          aria-label={`${dir === 'down' ? 'Download' : 'Upload'}, share of Smart Queue’s limit`}
          indicatorClassName={dir === 'down' ? 'bg-chart-2' : 'bg-chart-1'}
        />
      )}
    </div>
  );
}

/** A line between the rows that show (a row that doesn't fit is hidden, and takes no line with it). */
const ROWS = 'flex flex-col [&>*:not(:first-child)]:border-t';

const protoName: Record<string, string> = { dhcp: 'Automatic (DHCP)', pppoe: 'PPPoE', static: 'Static IP' };

export function InternetDetailsCard({ d, ap }: { d: Dashboard; ap: boolean }): ReactElement {
  const latest = d.history[d.history.length - 1];
  const tall = useWidgetInfo().size.h === 2;

  if (ap) {
    const gateway = d.lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
    const online = d.lan?.up === true && gateway !== undefined;
    return (
      <Widget
        title="Main router"
        aside={
          <>
            <StateBadge tone={online ? 'success' : 'destructive'}>{online ? 'Connected' : 'Not connected'}</StateBadge>
            <WidgetLink to={pageLink('mode')}>Operating mode</WidgetLink>
          </>
        }
      >
        <dl className={cn(ROWS, 'px-5')}>
          <Row label="Main router">{gateway ?? '—'}</Row>
          <Row label="This router">{ipv4(d.lan)?.split('/')[0] ?? 'No IPv4 address'}</Row>
          {d.lan?.uptime !== undefined && <Row label="Connected for">{formatDuration(d.lan.uptime)}</Row>}
        </dl>
      </Widget>
    );
  }

  const wan = d.wan;
  const online = wan?.up === true;
  const v4 = ipv4(wan)?.split('/')[0];
  const behind = wanBehindNat(v4);
  // many providers give the router no IPv6 address of its own, only a range for the devices
  const v6 = wanIpv6([d.wan6, wan]);
  const gateway = wan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
  const down = d.cake.find((c) => c.download);
  const up = d.cake.find((c) => !c.download);
  // one row tall: the details only (the Internet widget has the rates)
  const rates = online && tall;

  return (
    <Widget
      aside={
        <>
          <StateBadge tone={wan === undefined ? 'off' : online ? 'success' : 'destructive'}>
            {wan === undefined ? 'Not set up' : online ? 'Online' : 'Offline'}
          </StateBadge>
          <WidgetLink to={pageLink('internet')}>Internet</WidgetLink>
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-5">
        {rates && (
          <div className="flex flex-col gap-3">
            <Rate dir="down" rate={latest?.wanDown} limit={down?.bandwidth} />
            <Rate dir="up" rate={latest?.wanUp} limit={up?.bandwidth} />
          </div>
        )}
        {/* the details at the foot, under the rates, however tall its cell */}
        <dl className={cn(ROWS, rates && 'mt-auto')}>
          <Row label={behind === undefined ? 'Public address' : 'WAN address'}>
            {v4 ?? 'No IPv4 address'}
            {behind !== undefined && (
              <span className="block text-xs font-normal text-muted-foreground">
                {behind === 'cgnat'
                  ? 'Shared by your provider between customers (CGNAT)'
                  : 'Private: behind another router, like your provider’s'}
              </span>
            )}
          </Row>
          {/* an IPv6 address may break anywhere rather than overflow */}
          {(v6.address !== undefined || v6.range === undefined) && (
            <Row label="IPv6">
              <span className="break-all">{v6.address?.split('/')[0] ?? 'None'}</span>
            </Row>
          )}
          {v6.range !== undefined && (
            <Row label="IPv6 range">
              <span className="break-all">{v6.range}</span>
            </Row>
          )}
          {online && wan.uptime !== undefined && <Row label="Connected for">{formatDuration(wan.uptime)}</Row>}
          {wan !== undefined && <Row label="Connection">{protoName[wan.proto] ?? wan.proto}</Row>}
          {gateway !== undefined && <Row label="Gateway">{gateway}</Row>}
          <Row label="Smart Queue">
            {d.cake.length === 0 ? (
              <Link {...pageLink('sqm')} className="link">
                Off: set it up
              </Link>
            ) : (
              <>
                {down?.bandwidth === undefined ? 'no limit' : formatBitrate(down.bandwidth)} down,{' '}
                {up?.bandwidth === undefined ? 'no limit' : formatBitrate(up.bandwidth)} up
              </>
            )}
          </Row>
        </dl>
      </div>
    </Widget>
  );
}
