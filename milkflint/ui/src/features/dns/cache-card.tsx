import { InfoIcon, ZapIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { type CacheStage, cacheStages, httpsHint, keepLabel, sizeHint } from './cache-stages';
import { DEFAULT_CACHE_SIZE, type DnsForm } from './model';
import { DEFAULT_KEEP_HOURS, KEEP_HOURS } from './upstreams';

const SETTINGS = 'divide-y rounded-lg border p-3';

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** A setting: what it is on the left, its control on the right (below on narrow screens). */
function Setting({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** One stage of an answer's life: a dot on the line, how long it lasts, and what devices get. */
function Stage({ stage, last, children }: { stage: CacheStage; last: boolean; children?: ReactNode }): ReactElement {
  return (
    <li className="flex gap-3">
      <div aria-hidden className="flex flex-col items-center pt-1">
        <span
          className={cn(
            'size-3 shrink-0 rounded-full border-2',
            !stage.instant ? 'border-muted-foreground/50 bg-card' : stage.id === 'fresh' ? 'border-primary bg-primary' : 'border-primary bg-primary/25',
          )}
        />
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-3', !last && 'pb-6')}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium">{stage.title}</h4>
            {stage.lasts !== undefined && <span className="text-xs text-muted-foreground">{stage.lasts}</span>}
            <Badge variant={stage.instant ? 'success' : 'secondary'} className="ml-auto">
              {stage.instant ? 'Answered at once' : 'Device waits'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{stage.text}</p>
        </div>
        {children !== undefined && <div className={SETTINGS}>{children}</div>}
      </div>
    </li>
  );
}

/** The DNS cache card: the master switch, what the router keeps, then what happens to an answer over time. */
export function CacheCard({
  form,
  set,
  sizeError,
}: {
  form: DnsForm;
  set: <K extends keyof DnsForm>(key: K, value: DnsForm[K]) => void;
  sizeError: string | undefined;
}): ReactElement {
  const stages = cacheStages(form);
  const reuse = (
    <>
      <Setting id="dns-quick" label="Keep using expired answers" hint="Rarely, a site that has just moved won’t load first time; reloading fixes it.">
        <Switch
          id="dns-quick"
          checked={form.quick}
          onCheckedChange={(v) => {
            set('quick', v);
          }}
        />
      </Setting>
      {form.quick && (
        <Setting id="dns-keep" label="Keep them for" hint="Counted from when the answer expires. A site visited at least this often doesn’t wait for a lookup.">
          <Select
            value={form.keepHours}
            onValueChange={(v) => {
              set('keepHours', v);
            }}
          >
            <SelectTrigger id="dns-keep" className="w-48">
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
        </Setting>
      )}
    </>
  );
  return (
    <Card className="xl:col-span-2">
      <CardHeading
        icon={ZapIcon}
        title="DNS cache"
        description={
          form.cacheOn
            ? 'The router remembers the answers it gets, so repeat lookups don’t wait for the DNS server.'
            : 'Off: every lookup goes out to the DNS server, and devices wait for the answer each time.'
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
        <CardContent className="flex max-w-3xl flex-col gap-6">
          {form.devices.own && (
            <Alert variant="info">
              <InfoIcon />
              <AlertDescription>Your devices ask another server, so only lookups that still reach the router use this cache.</AlertDescription>
            </Alert>
          )}
          <Section title="What the router keeps">
            <div className={SETTINGS}>
              <Setting id="dns-cache-size" label="Answers to keep" hint={sizeHint(form)} error={sizeError}>
                <Input
                  id="dns-cache-size"
                  className="w-28 font-mono"
                  inputMode="numeric"
                  placeholder={DEFAULT_CACHE_SIZE}
                  value={form.cacheSize}
                  aria-invalid={sizeError !== undefined}
                  onChange={(e) => {
                    set('cacheSize', e.target.value.trim());
                  }}
                />
              </Setting>
              <Setting id="dns-cache-https" label="HTTPS records too" hint={httpsHint(form)}>
                <Switch
                  id="dns-cache-https"
                  checked={form.cacheHttps}
                  onCheckedChange={(v) => {
                    set('cacheHttps', v);
                  }}
                />
              </Setting>
            </div>
          </Section>
          <Section title="What happens to each answer">
            <ol aria-label="What happens to each answer">
              {stages.map((stage, i) => (
                <Stage key={stage.id} stage={stage} last={i === stages.length - 1}>
                  {stage.id === 'expired' ? reuse : undefined}
                </Stage>
              ))}
            </ol>
          </Section>
        </CardContent>
      )}
    </Card>
  );
}
