// The internet connection in detail: what it carries now (against Smart
// Queue's limits while it shapes), the router's addresses on it, how long
// it's been connected and how. In access point mode, the link to the main
// router instead.
import { EthernetPortIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { globalIpv6, ipv4 } from '@/lib/api/network';
import { formatBitrate, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { wanBehindNat } from '../firewall/api';
import type { Dashboard } from './use-dashboard';
import { StateBadge, Way, Widget, WidgetLink } from './widget';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words tabular">{children}</dd>
    </div>
  );
}

function Rate({ dir, rate, limit }: { dir: 'down' | 'up'; rate: number | undefined; limit: number | undefined }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          <Way dir={dir} /> {dir === 'down' ? 'Download' : 'Upload'} now
        </span>
        <span className="font-medium tabular">
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

const protoName: Record<string, string> = { dhcp: 'Automatic (DHCP)', pppoe: 'PPPoE', static: 'Static IP' };

export function InternetDetailsCard({ d, ap }: { d: Dashboard; ap: boolean }): ReactElement {
  const latest = d.history[d.history.length - 1];

  if (ap) {
    const gateway = d.lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
    const online = d.lan?.up === true && gateway !== undefined;
    return (
      <Widget
        icon={EthernetPortIcon}
        title="Main router"
        aside={
          <>
            <StateBadge tone={online ? 'success' : 'destructive'}>{online ? 'Connected' : 'Not connected'}</StateBadge>
            <WidgetLink href={href('mode')}>Operating mode</WidgetLink>
          </>
        }
      >
        <dl className="divide-y px-5">
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
  const v6 = globalIpv6([...(d.wan6?.['ipv6-address'] ?? []), ...(wan?.['ipv6-address'] ?? [])].map((a) => a.address))[0];
  const prefix = d.wan6?.['ipv6-prefix']?.[0];
  const gateway = wan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
  const down = d.cake.find((c) => c.download);
  const up = d.cake.find((c) => !c.download);

  return (
    <Widget
      icon={EthernetPortIcon}
      title="Internet connection"
      aside={
        <>
          <StateBadge tone={wan === undefined ? 'off' : online ? 'success' : 'destructive'}>
            {wan === undefined ? 'Not set up' : online ? 'Online' : 'Offline'}
          </StateBadge>
          <WidgetLink href={href('internet')}>Internet</WidgetLink>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-5">
        {online && (
          <div className="flex flex-col gap-3">
            <Rate dir="down" rate={latest?.wanDown} limit={down?.bandwidth} />
            <Rate dir="up" rate={latest?.wanUp} limit={up?.bandwidth} />
          </div>
        )}
        <dl className="divide-y">
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
          <Row label="IPv6">
            {/* an IPv6 address may break anywhere rather than overflow */}
            <span className="break-all">
              {v6 ?? (prefix === undefined ? 'None' : `${prefix.address}/${String(prefix.mask)}`)}
            </span>
          </Row>
          {online && wan.uptime !== undefined && <Row label="Connected for">{formatDuration(wan.uptime)}</Row>}
          {wan !== undefined && <Row label="Connection">{protoName[wan.proto] ?? wan.proto}</Row>}
          {gateway !== undefined && <Row label="Gateway">{gateway}</Row>}
          <Row label="Smart Queue">
            {d.cake.length === 0 ? (
              <a href={href('sqm')} className="link">
                Off: set it up
              </a>
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
