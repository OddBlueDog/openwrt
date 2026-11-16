// The DNS cache: the master switch, what the router keeps, then what happens
// to an answer over time, with the settings for expired answers at the point
// in that timeline where they take effect.
import { InfoIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { explain } from '@/components/explain';
import { type CacheStage, cacheStages, httpsHint, keepLabel, sizeHint } from './cache-stages';
import { DEFAULT_CACHE_SIZE, type DnsForm } from './model';
import { DEFAULT_KEEP_HOURS, KEEP_HOURS } from './upstreams';

const DNSMASQ = 'dhcp.@dnsmasq[0]';

/** One stage of an answer's life: a dot on the line, how long it lasts, and what devices get. */
function Stage({ stage, last, children }: { stage: CacheStage; last: boolean; children?: ReactNode }): ReactElement {
  return (
    <li className="flex gap-3">
      <div aria-hidden className="flex flex-col items-center pt-1">
        <span
          className={cn(
            'size-3 shrink-0 rounded-full border-2',
            !stage.instant
              ? 'border-muted-foreground/50 bg-card'
              : stage.id === 'fresh'
                ? 'border-primary bg-primary'
                : 'border-primary bg-primary/25',
          )}
        />
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', !last && 'pb-6')}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium">{stage.title}</h4>
            {stage.lasts !== undefined && <span className="text-xs text-muted-foreground">{stage.lasts}</span>}
            <Badge variant={stage.instant ? 'success' : 'secondary'} className="ml-auto">
              {stage.instant ? 'Answered at once' : 'Device waits'}
            </Badge>
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">{stage.text}</p>
        </div>
        {children !== undefined && <div className="divide-y border-y">{children}</div>}
      </div>
    </li>
  );
}

/** The DNS cache card: the master switch, what the router keeps, then what happens to an answer over time. */
export function CacheCard({
  form,
  set,
  sizeError,
  adguard = false,
}: {
  form: DnsForm;
  set: <K extends keyof DnsForm>(key: K, value: DnsForm[K]) => void;
  sizeError: string | undefined;
  /** AdGuard Home is on: it keeps a cache of its own in front of this one */
  adguard?: boolean;
}): ReactElement {
  const stages = cacheStages(form);
  // encrypted DNS reuses expired answers in dnsproxy, the others in dnsmasq
  const proxy = form.mode === 'encrypted';
  const reuse = (
    <>
      <Field
        id="dns-quick"
        label="Keep using expired answers"
        {...explain(
          'Devices get the old answer at once while the router fetches a new one. Rarely, a site that has just moved won’t load first time; reloading fixes it.',
          proxy ? ['dnsproxy.cache.enabled', 'dnsproxy.cache.cache_optimistic'] : [`${DNSMASQ}.use_stale_cache`],
        )}
      >
        <Switch
          id="dns-quick"
          checked={form.quick}
          onCheckedChange={(v) => {
            set('quick', v);
          }}
        />
      </Field>
      {form.quick && (
        <Field
          id="dns-keep"
          label="Keep them for"
          {...explain(
            'Counted from when the answer expires. A site visited at least this often doesn’t wait for a lookup.',
            proxy ? ['dnsproxy.cache.optimistic_max_age'] : [`${DNSMASQ}.use_stale_cache (in seconds)`],
          )}
        >
          <Select
            value={form.keepHours}
            onValueChange={(v) => {
              set('keepHours', v);
            }}
          >
            <SelectTrigger id="dns-keep">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEEP_HOURS.map((h) => (
                <SelectItem key={h} value={h}>
                  {keepLabel(h)}
                  {h === DEFAULT_KEEP_HOURS ? ' (default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
  return (
    <Card>
      <CardHeading
        title="DNS cache"
        description={
          form.cacheOn ? 'The router remembers the answers it gets, so repeat lookups don’t wait for the DNS server.' : undefined
        }
        status={
          form.cacheOn
            ? undefined
            : 'Off: every lookup goes out to the DNS server, and devices wait for the answer each time. Turn it on with the switch.'
        }
        action={
          <Switch
            id="dns-cache-on"
            aria-label="DNS cache on"
            checked={form.cacheOn}
            onCheckedChange={(v) => {
              set('cacheOn', v);
            }}
          />
        }
      />
      {form.cacheOn && (
        <CardContent className="flex flex-col gap-4">
          {form.devices.own && (
            <Note tone="info" icon={<InfoIcon />}>
              Your devices ask another server, so only lookups that still reach the router use this cache.
            </Note>
          )}
          {adguard && !form.devices.own && (
            <Note tone="info" icon={<InfoIcon />}>
              AdGuard Home keeps a small cache of its own in front of this one, so your devices’ repeat lookups don’t wait for the
              round trip to it. This one keeps what AdGuard Home passes on, and the router’s own lookups.
            </Note>
          )}
          <section aria-labelledby="dns-keeps" className="flex flex-col">
            <h3 id="dns-keeps" className="text-sm font-medium">
              What the router keeps
            </h3>
            <div className="divide-y">
              <Field
                id="dns-cache-size"
                label="Answers to keep"
                {...explain(`How many answers the router remembers. ${sizeHint(form)}`, [
                  `${DNSMASQ}.cachesize (0 turns the cache off)`,
                ])}
                error={sizeError}
              >
                <Input
                  id="dns-cache-size"
                  className="w-28 tabular"
                  inputMode="numeric"
                  placeholder={DEFAULT_CACHE_SIZE}
                  value={form.cacheSize}
                  aria-invalid={sizeError !== undefined}
                  onChange={(e) => {
                    set('cacheSize', e.target.value.trim());
                  }}
                />
              </Field>
              <Field id="dns-cache-https" label="HTTPS records too" {...explain(httpsHint(form), [`${DNSMASQ}.cache_rr`])}>
                <Switch
                  id="dns-cache-https"
                  checked={form.cacheHttps}
                  onCheckedChange={(v) => {
                    set('cacheHttps', v);
                  }}
                />
              </Field>
            </div>
          </section>
          <section aria-labelledby="dns-stages" className="flex flex-col gap-4 border-t pt-5">
            <h3 id="dns-stages" className="text-sm font-medium">
              What happens to each answer
            </h3>
            <ol aria-labelledby="dns-stages" className="max-w-3xl">
              {stages.map((stage, i) => (
                <Stage key={stage.id} stage={stage} last={i === stages.length - 1}>
                  {stage.id === 'expired' ? reuse : undefined}
                </Stage>
              ))}
            </ol>
          </section>
        </CardContent>
      )}
    </Card>
  );
}
