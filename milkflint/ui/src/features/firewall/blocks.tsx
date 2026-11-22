// Blocking a device from the internet, from the Firewall page: Device
// control's own sheet for a device on its own (always, at set times, or only
// when paused), so both pages write the same rules: an overnight time is an
// evening rule and a morning rule (the days are the nights picked), open
// connections end when a block starts, and the times follow summer time.
// Older Block a device rules stay as they are; Device control shows them,
// and takes one over when it's edited there.
import type { ReactElement } from 'react';
import type { Change } from '@/lib/api/uci';
import { isPrivateMac } from '@/lib/api/network';
import { interceptOn } from '../dns/intercept';
import { parsePeople } from '../device-control/model';
import { PersonSheet } from '../device-control/person-sheet';
import { GUEST_IDS } from '../wifi-guest/guest';
import { type FirewallData, zoneForIp } from './api';

export function BlockSheet({
  data,
  onClose,
  onSave,
}: {
  data: FirewallData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const guestZones = data.cfg.zones.filter((z) => GUEST_IDS.some((g) => g === z.name)).map((z) => z.name);
  const names = data.names.byMac;
  return (
    <PersonSheet
      data={{
        cfg: data.cfg,
        firewall: data.sections,
        milkflint: data.milkflint,
        people: parsePeople(data.milkflint),
        devices: data.devices.map((d) => {
          const zone = d.ip === undefined ? undefined : zoneForIp(data, d.ip);
          return {
            mac: d.mac,
            name: d.name,
            ip: d.ip,
            privateMac: isPrivateMac(d.mac),
            guest: zone !== undefined && guestZones.includes(zone),
          };
        }),
        guestZones,
        adguard: 'none',
        intercept: interceptOn(data.sections),
      }}
      entry={undefined}
      kind="device"
      blocking
      me={undefined}
      deviceName={(mac) => names.get(mac)}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
