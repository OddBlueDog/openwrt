// A device's speed right now: from its Wi-Fi station counters every 2 s, or, wired, from the byte sums of its
// connections (what passes through the router) every few seconds.
import { type ReactElement, useRef } from 'react';
import { Dir } from '@/components/dir';
import { pollDelay } from '@/features/lan/connections';
import { getConnections } from '@/features/lan/connections-api';
import { useByteRates } from '@/hooks/use-byte-rates';
import { loadAddressNames } from '@/lib/api/names';
import { getStations, getWirelessStatus } from '@/lib/api/wireless';
import { formatBitrate } from '@/lib/format';
import type { ByteSample } from '@/lib/rates';

const WIFI_MS = 2000;
const WIRED_MS = 5000;
const NAMES_MS = 60_000;

/** How a device is connected, where the caller knows (the sheet does); undefined looks for it among the stations. */
export type Link = 'wifi' | 'wired' | undefined;

/** A different device starts over: no baseline and no figure of the last one's. */
export function DeviceLive({ mac, link }: { mac: string; link?: Link }): ReactElement {
  return <Live key={mac.toLowerCase()} mac={mac} link={link} />;
}

function Live({ mac, link }: { mac: string; link: Link }): ReactElement {
  const wanted = mac.toLowerCase();
  const addrs = useRef<{ at: number; list: string[] } | undefined>(undefined);
  const aps = useRef<{ at: number; ifnames: string[] } | undefined>(undefined);
  const cost = useRef<number | undefined>(undefined);

  /** The Wi-Fi counters if the device is a station; null if it isn't one; throws if an access point couldn't be read. */
  const station = async (): Promise<ByteSample | null> => {
    const now = Date.now();
    if (aps.current === undefined || now - aps.current.at >= NAMES_MS) {
      const status = await getWirelessStatus();
      const ifnames = Object.values(status).flatMap((r) =>
        (r.interfaces ?? []).flatMap((i) => (i.ifname !== undefined && (i.config?.mode ?? 'ap') === 'ap' ? [i.ifname] : [])),
      );
      aps.current = { at: now, ifnames };
    }
    const lists = await Promise.all(aps.current.ifnames.map((n) => getStations(n)));
    for (const s of lists.flat()) {
      if (s.mac.toLowerCase() === wanted) return { kind: 'wifi', down: s.tx?.bytes ?? 0, up: s.rx?.bytes ?? 0, at: Date.now() };
    }
    return null;
  };

  const sample = async (): Promise<ByteSample | undefined> => {
    if (link !== 'wired') {
      try {
        const wifi = await station();
        if (wifi !== null) return wifi;
      } catch {
        // an access point we couldn't read: we can't tell where the device is
        return undefined;
      }
    }
    const now = Date.now();
    if (addrs.current === undefined || now - addrs.current.at >= NAMES_MS) {
      const names = await loadAddressNames();
      const list = [...names].filter(([, who]) => who.mac?.toLowerCase() === wanted).map(([addr]) => addr);
      addrs.current = { at: now, list };
    }
    // no address known for it: nothing to add up
    if (addrs.current.list.length === 0) return undefined;
    const conns = await getConnections({ rows: 0 });
    cost.current = conns.cost_ms;
    let down = 0;
    let up = 0;
    for (const d of conns.devices) {
      if (!addrs.current.list.includes(d.addr)) continue;
      down += d.in;
      up += d.out;
    }
    return { kind: 'wired', down, up, at: Date.now() };
  };

  const rates = useByteRates([wanted, link ?? 'any'], sample, (last) =>
    last?.kind === 'wired' ? pollDelay(WIRED_MS, cost.current) : WIFI_MS,
  );
  const show = (v: number | undefined): string => (v === undefined ? '…' : formatBitrate(v));

  return (
    <div className="py-2 text-sm" data-device-live="">
      <p>
        <span className="text-muted-foreground">Now</span>{' '}
        <span className="tabular-nums">
          <Dir d="down" /> {show(rates.down)}
        </span>{' '}
        <span className="tabular-nums">
          <Dir d="up" /> {show(rates.up)}
        </span>
      </p>
      {rates.kind === 'wired' && (
        <p className="text-xs text-muted-foreground">
          Through the router: traffic to other devices on your network isn&apos;t counted.
        </p>
      )}
    </div>
  );
}
