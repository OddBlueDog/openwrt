import { CableIcon, LoaderCircleIcon, PencilIcon, PinIcon, SearchIcon, SmartphoneIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { SignalBars } from '@/components/charts/signal-bars';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApply } from '@/hooks/use-apply';
import { usePoll } from '@/hooks/use-poll';
import { getHostHints, getLeases, getNeighbors, inSubnet, ipToInt, isReachable, prefixLength } from '@/lib/api/network';
import { type Change, getConfig, list, type Section, str } from '@/lib/api/uci';
import { bandOf, getAccessPoints } from '@/lib/api/wireless';
import { formatBitrate, formatDuration } from '@/lib/format';

interface Device {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  wifi: { band: string | undefined; ssid: string | undefined; signal: number | undefined; rate: number | undefined; connected: number | undefined } | undefined;
  online: boolean;
  leaseExpires: number | undefined;
  reservation: Section | undefined;
}

interface ClientsData {
  devices: Device[];
  routerIp: string;
  prefix: number;
}

async function loadClients(): Promise<ClientsData> {
  const [leases, hints, neighbors, aps, dhcp, network] = await Promise.all([
    getLeases().catch(() => []),
    getHostHints().catch(() => ({})),
    getNeighbors().catch(() => []),
    getAccessPoints().catch(() => []),
    getConfig('dhcp'),
    getConfig('network'),
  ]);
  const lan = network.find((s) => s['.name'] === 'lan');
  const routerIp = str(lan, 'ipaddr')?.split('/')[0] ?? '192.168.1.1';
  const prefix = str(lan, 'ipaddr')?.includes('/') === true ? Number(str(lan, 'ipaddr')?.split('/')[1]) : prefixLength(str(lan, 'netmask'));

  const devices = new Map<string, Device>();
  const get = (mac: string): Device => {
    const key = mac.toLowerCase();
    let d = devices.get(key);
    if (d === undefined) {
      d = { mac: key, name: undefined, ip: undefined, wifi: undefined, online: false, leaseExpires: undefined, reservation: undefined };
      devices.set(key, d);
    }
    return d;
  };

  // Devices that answered recently on the LAN. (The router's own addresses
  // and anything outside the LAN, like the WAN gateway, aren't clients.)
  for (const n of neighbors) {
    if (!inSubnet(n.ip, routerIp, prefix) || n.ip === routerIp) continue;
    const d = get(n.mac);
    d.ip = n.ip;
    if (isReachable(n)) d.online = true;
  }
  for (const [mac, h] of Object.entries(hints)) {
    const d = devices.get(mac.toLowerCase());
    if (d !== undefined) d.name = h.name ?? d.name;
  }
  for (const l of leases) {
    const d = get(l.macaddr);
    d.name = l.hostname ?? d.name;
    d.ip = l.ipaddr ?? d.ip;
    d.leaseExpires = l.expires;
  }
  for (const ap of aps) {
    for (const s of ap.stations) {
      const d = get(s.mac);
      d.online = true;
      d.wifi = {
        band: bandOf(ap.info?.frequency),
        ssid: ap.ssid,
        signal: s.signal_avg ?? s.signal,
        rate: s.tx?.rate === undefined ? undefined : s.tx.rate * 1000,
        connected: s.connected_time,
      };
    }
  }
  for (const host of dhcp.filter((s) => s['.type'] === 'host')) {
    for (const mac of list(host, 'mac')) {
      const d = get(mac);
      d.reservation = host;
      d.name = str(host, 'name') ?? d.name;
      d.ip = str(host, 'ip') ?? d.ip;
    }
  }

  const sorted = [...devices.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (ipToInt(a.ip ?? '') ?? 1e10) - (ipToInt(b.ip ?? '') ?? 1e10);
  });
  return { devices: sorted, routerIp, prefix };
}

function EditDialog({
  device,
  data,
  onClose,
  onSave,
}: {
  device: Device;
  data: ClientsData;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const [name, setName] = useState(device.name ?? '');
  const [reserve, setReserve] = useState(device.reservation !== undefined);
  const [ip, setIp] = useState(device.ip ?? '');

  const takenBy = data.devices.find((d) => d.mac !== device.mac && d.reservation !== undefined && d.ip === ip);
  const ipError = !reserve
    ? undefined
    : !inSubnet(ip, data.routerIp, data.prefix)
      ? `Use an address in your network (${data.routerIp}/${String(data.prefix)}).`
      : ip === data.routerIp
        ? 'That’s the router’s own address.'
        : takenBy !== undefined
          ? `Already reserved for ${takenBy.name ?? takenBy.mac}.`
          : undefined;
  const nameError = name !== '' && !/^[A-Za-z0-9-]{1,63}$/.test(name) ? 'Letters, digits and hyphens only (it becomes the device’s local name).' : undefined;

  const save = (): void => {
    const section = device.reservation?.['.name'];
    if (!reserve && name === '') {
      onSave(section === undefined ? [] : [{ op: 'delete', config: 'dhcp', section }]);
    } else if (section === undefined) {
      onSave([
        {
          op: 'add',
          config: 'dhcp',
          type: 'host',
          values: { mac: device.mac, dns: '1', ...(name === '' ? {} : { name }), ...(reserve ? { ip } : {}) },
        },
      ]);
    } else {
      const changes: Change[] = [{ op: 'set', config: 'dhcp', section, values: { ...(name === '' ? {} : { name }), ...(reserve ? { ip } : {}) } }];
      const unset = [...(name === '' ? ['name'] : []), ...(reserve ? [] : ['ip'])];
      if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section, options: unset });
      onSave(changes);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{device.name ?? 'Unnamed device'}</DialogTitle>
          <DialogDescription className="font-mono">{device.mac}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="dev-name">Name</Label>
            <Input
              id="dev-name"
              value={name}
              placeholder="e.g. living-room-tv"
              aria-invalid={nameError !== undefined}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            {nameError !== undefined && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="dev-reserve">Always give it the same address</Label>
              <p className="mt-1 text-xs text-muted-foreground">A DHCP reservation, handy for port forwards and printers.</p>
            </div>
            <Switch id="dev-reserve" checked={reserve} onCheckedChange={setReserve} />
          </div>
          {reserve && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="dev-ip">IP address</Label>
              <Input
                id="dev-ip"
                value={ip}
                className="font-mono"
                aria-invalid={ipError !== undefined}
                onChange={(e) => {
                  setIp(e.target.value.trim());
                }}
              />
              {ipError !== undefined && <p className="text-xs text-destructive">{ipError}</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={ipError !== undefined || nameError !== undefined}>
            Save &amp; apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClientsPage(): ReactElement {
  const { data, error, loading, refresh } = usePoll(loadClients, 5000);
  const { state, apply } = useApply(refresh);
  const [editing, setEditing] = useState<string>();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.devices ?? []).filter(
      (d) => q === '' || [d.name, d.ip, d.mac, d.wifi?.ssid].some((v) => v?.toLowerCase().includes(q) === true),
    );
  }, [data, query]);
  const editingDevice = data?.devices.find((d) => d.mac === editing);
  const close = useCallback(() => {
    setEditing(undefined);
  }, []);
  const online = data?.devices.filter((d) => d.online).length ?? 0;

  return (
    <>
      <PageHeader
        title="Clients"
        description={data === undefined ? 'Devices on your network.' : `${String(online)} online · ${String(data.devices.length)} known`}
        actions={
          <div className="relative w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search devices"
              placeholder="Search name, IP or MAC"
              value={query}
              className="pl-9"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={refresh} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Device</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Link speed</TableHead>
                    <TableHead>Connected</TableHead>
                    <TableHead className="sr-only">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((d) => (
                    <TableRow key={d.mac} className={d.online ? undefined : 'opacity-60'}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative flex size-9 items-center justify-center rounded-full bg-secondary">
                            {d.wifi === undefined ? (
                              <CableIcon className="size-4 text-muted-foreground" />
                            ) : (
                              <SmartphoneIcon className="size-4 text-muted-foreground" />
                            )}
                            <span
                              className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card ${d.online ? 'bg-success' : 'bg-muted-foreground/40'}`}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 font-medium">
                              {d.name ?? 'Unnamed device'}
                              {d.reservation !== undefined && str(d.reservation, 'ip') !== undefined && (
                                <Badge variant="secondary" className="gap-1 font-normal">
                                  <PinIcon /> reserved
                                </Badge>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {d.ip ?? 'no address'} · {d.mac}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {d.wifi === undefined ? (d.online ? 'Wired' : 'Offline') : `${d.wifi.band ?? 'Wi-Fi'} · ${d.wifi.ssid ?? ''}`}
                      </TableCell>
                      <TableCell>
                        {d.wifi === undefined ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex items-center gap-2 tabular">
                            <SignalBars dbm={d.wifi.signal} />
                            <span className="text-xs text-muted-foreground">
                              {d.wifi.signal === undefined ? '' : `${String(d.wifi.signal)} dBm`}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular">
                        {d.wifi?.rate === undefined ? '—' : formatBitrate(d.wifi.rate)}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular">
                        {d.wifi?.connected === undefined ? '—' : formatDuration(d.wifi.connected)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(d.mac);
                          }}
                          disabled={state.phase === 'applying'}
                        >
                          {state.phase === 'applying' && editing === d.mac ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : (
                            <PencilIcon />
                          )}
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {query === '' ? 'No devices seen yet.' : 'No device matches your search.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      {editingDevice !== undefined && data !== undefined && (
        <EditDialog
          device={editingDevice}
          data={data}
          onClose={close}
          onSave={(changes) => {
            close();
            void apply(changes);
          }}
        />
      )}
    </>
  );
}
