// One network the scan heard, in a side sheet: how loud it is here, whether
// it shares this router's channels, and what it says about itself.
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { InfoRow } from '@/components/card-heading';
import { SignalBars } from '@/components/charts/signal-bars';
import { Note } from '@/components/note';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ScannedNetwork } from './api';
import type { Radio } from './model';
import {
  bandLabel,
  channelRange,
  coveredChannels,
  coverLabel,
  overlapMhz,
  securityOf,
  signalWord,
  spanOf,
  standardLabel,
} from './spectrum';

export function NetworkSheet({
  network: n,
  radios,
  onClose,
}: {
  network: ScannedNetwork;
  radios: readonly Radio[];
  onClose: () => void;
}): ReactElement {
  const security = securityOf(n);
  const mine = radios.find((r) => r.band === n.band)?.span;
  const shared = mine === undefined ? 0 : overlapMhz(spanOf(n), mine);
  const exact = mine !== undefined && shared > 0 && spanOf(n)[0] === mine[0] && spanOf(n)[1] === mine[1];
  const device = [n.wps?.manufacturer, n.wps?.model ?? n.wps?.name].filter((x) => x !== undefined).join(' ');
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby="nearby-network-address">
        <div className="border-b px-6 py-4">
          <SheetTitle className={cn('truncate', n.ssid === null && 'text-muted-foreground italic')}>
            {n.ssid ?? 'Hidden network'}
          </SheetTitle>
          <SheetDescription id="nearby-network-address" className="mt-0.5 font-mono text-xs">
            {n.bssid}
          </SheetDescription>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <SignalBars dbm={n.signal ?? undefined} className="h-6 gap-[3px] [&>span]:w-[5px]" />
            <div>
              <div className="text-xl font-semibold tabular">{n.signal === null ? '—' : `${String(n.signal)} dBm`}</div>
              <div className="text-xs text-muted-foreground">{signalWord(n.signal)} here</div>
            </div>
          </div>
          {shared > 0 && (
            <Note
              tone="warning"
              icon={<TriangleAlertIcon />}
              title={exact ? 'On exactly your channels' : 'Overlaps your channels'}
            >
              {exact
                ? 'Your devices and its take turns to use the air.'
                : `It overlaps ${String(shared)} MHz of your ${String(mine === undefined ? 0 : mine[1] - mine[0])} MHz. Partly overlapping networks can’t take turns cleanly, so they get in each other’s way.`}
            </Note>
          )}
          <div>
            <InfoRow label="Band">{bandLabel(n.band)}</InfoRow>
            <InfoRow label="Channel">
              {channelRange(n)} · {n.width} MHz{n.width > 20 ? ` (main ${String(n.channel)})` : ''}
            </InfoRow>
            <InfoRow label="Covers">
              {coveredChannels(n).length > 1 ? 'Channels' : 'Channel'} {coverLabel(n)} ({spanOf(n)[0]}–{spanOf(n)[1]} MHz)
            </InfoRow>
            <InfoRow label="Standard">{standardLabel(n.standard)}</InfoRow>
            <InfoRow label="Security">
              <span className={security.weak ? 'text-warning' : undefined}>{security.label}</span>
              {n.security.rsn?.mfp === 'required' ? ' · PMF' : ''}
            </InfoRow>
            {n.stations !== undefined && n.stations !== null && <InfoRow label="Devices on it">{n.stations}</InfoRow>}
            {n.utilization !== undefined && n.utilization !== null && (
              <InfoRow label="Its channel busy">{formatPercent(n.utilization)}</InfoRow>
            )}
            {device !== '' && <InfoRow label="Device">{device}</InfoRow>}
            {n.country !== undefined && n.country !== null && <InfoRow label="Country">{n.country}</InfoRow>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
