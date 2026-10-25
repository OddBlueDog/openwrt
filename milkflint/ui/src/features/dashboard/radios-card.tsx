import { RadioTowerIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { href } from '@/lib/router';
import type { Dashboard } from './use-dashboard';

export function RadiosCard({ d }: { d: Dashboard }): ReactElement {
  const radios = d.radios;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Radios</CardTitle>
          <CardDescription>
            {radios.length} active · {d.clients.length} client{d.clients.length === 1 ? '' : 's'}
          </CardDescription>
        </div>
        <CardAction>
          <a href={href('wifi')} className="text-xs text-primary hover:underline">
            Wi-Fi settings
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {radios.length === 0 && <p className="text-sm text-muted-foreground">No Wi-Fi radio is up.</p>}
        {radios.map((r) => (
          <div key={r.name} className="flex gap-3 rounded-lg border bg-background/60 p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <RadioTowerIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.band ?? r.name}</span>
                <Badge variant={r.up ? 'success' : 'secondary'}>{r.up ? 'On' : 'Off'}</Badge>
              </div>
              <div className="truncate text-sm text-muted-foreground">{r.ssids.length > 0 ? r.ssids.join(', ') : 'No network'}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                {r.channel !== undefined && <span>ch {r.channel}</span>}
                {r.htmode !== undefined && <span>{r.htmode}</span>}
                {r.txpower !== undefined && <span>{r.txpower} dBm</span>}
                {r.noise !== undefined && r.noise !== 0 && <span>noise {r.noise} dBm</span>}
                <span>
                  {r.clients} client{r.clients === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
