import { SmartphoneIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { SignalBars } from '@/components/charts/signal-bars';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBitrate, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { Dashboard } from './use-dashboard';

export function ClientsCard({ d, className }: { d: Dashboard; className?: string }): ReactElement {
  return (
    // min-w-0: in the grid the table would widen the card past a phone's screen; it scrolls inside instead
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Wi-Fi clients</CardTitle>
          <CardDescription>Strongest signal first. Link speeds are what the radios negotiated.</CardDescription>
        </div>
        <CardAction>
          <a href={href('clients')} className="text-xs text-primary hover:underline">
            All devices
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="-mx-0 px-0">
        {d.clients.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">No devices are connected to the Wi-Fi right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Device</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Link ↓ / ↑</TableHead>
                <TableHead className="text-right">Connected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.clients.slice(0, 8).map((c) => (
                <TableRow key={c.mac}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-full bg-secondary">
                        <SmartphoneIcon className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{c.hostname ?? 'Unnamed device'}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{c.ip ?? c.mac}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.band ?? '—'}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 tabular">
                      <SignalBars dbm={c.signal} />
                      <span className="text-xs text-muted-foreground">
                        {c.signal === undefined ? '—' : `${String(c.signal)} dBm`}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default tabular underline decoration-dotted decoration-muted-foreground/50 underline-offset-4">
                          {c.txRate === undefined ? '—' : formatBitrate(c.txRate)} /{' '}
                          {c.rxRate === undefined ? '—' : formatBitrate(c.rxRate)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div>To device: {c.txDescription ?? 'unknown'}</div>
                        <div>From device: {c.rxDescription ?? 'unknown'}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular">
                    {c.connectedSeconds === undefined ? '—' : formatDuration(c.connectedSeconds)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
