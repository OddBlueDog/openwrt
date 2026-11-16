// Development only (`pnpm dev`, then #/specimen): every theme token and every
// shared component, in each theme and scheme side by side. Production builds
// leave this file out (app.tsx imports it behind import.meta.env.DEV).
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Logo } from '@/components/layout/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { pickableThemes, setThemeId, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { contrast } from '@/theme/color';
import { COLOR_TOKENS, type ColorToken, TEXT_SIZES } from '@/theme/contract';
import { schemesOf } from '@/theme/css';

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-4 border-t pt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const SERIES = [1, 2, 3, 4, 5, 6] as const;
const RAMP = [1, 2, 3, 4, 5] as const;

/** A small sample of everything, drawn inside whatever theme and scheme wrap it. */
function Sample(): ReactElement {
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col gap-4 bg-background p-4 text-foreground">
      <div className="flex items-center gap-3">
        <Logo className="size-7" />
        <span className="text-sm font-semibold">MilkFlint</span>
        <Badge variant="success" className="ml-auto">
          Online
        </Badge>
      </div>
      <Card className="gap-3 py-4">
        <CardHeading
          title="Wi-Fi 5 GHz"
          description="Channel 36 · 80 MHz · 6 devices"
          action={<Badge variant="warning">Busy</Badge>}
        />
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular">18</span>
            <span className="text-sm text-muted-foreground">ms now · 9 at rest</span>
          </div>
          <Progress value={78} aria-label="Airtime in use" />
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="sample-switch" className="text-sm font-medium">
              Allow DFS channels
            </label>
            <Switch id="sample-switch" checked={on} onCheckedChange={setOn} />
          </div>
          <Input aria-label="Network name" defaultValue="MilkFlint" />
          <div className="flex gap-2">
            <Button size="sm">Save &amp; apply</Button>
            <Button size="sm" variant="outline">
              Discard
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="flex gap-1.5">
        {SERIES.map((n) => (
          <span key={n} className="h-3 flex-1 rounded-sm" style={{ background: `var(--chart-${n})` }} />
        ))}
      </div>
    </div>
  );
}

export function SpecimenPage(): ReactElement {
  const { theme, dark } = useTheme();
  const themes = pickableThemes();
  const scheme = schemesOf(theme)[dark ? 'dark' : 'light'];
  const tokenContrast = (t: ColorToken): string => {
    const surface = /foreground|^primary$|^success$|^warning$|^destructive$|^info$|chart-axis/.test(t) ? 'card' : undefined;
    return surface === undefined ? '' : `${contrast(scheme.color[t], scheme.color[surface]).toFixed(1)}:1`;
  };

  return (
    <div className="mx-auto flex max-w-(--mf-content-max) flex-col gap-8 px-4 py-8 lg:px-(--mf-gutter)">
      <PageHeader
        title="Theme specimen"
        description="Every token and shared component in the theme you pick here. Development only."
        actions={
          <>
            <Select
              value={theme.id}
              onValueChange={(id) => {
                void setThemeId(id);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.hidden === true ? ' (hidden)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-36 rounded-lg bg-sidebar p-1" data-slot="sidebar">
              <ThemeToggle />
            </div>
          </>
        }
      />

      <Section title="Every theme, both schemes">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {themes.flatMap((t) =>
            (['false', 'true'] as const).map((d) => (
              <figure key={`${t.id}-${d}`} className="flex flex-col gap-2">
                <figcaption className="text-xs font-medium text-muted-foreground">
                  {t.name}, {d === 'true' ? 'dark' : 'light'}
                </figcaption>
                <div data-theme={t.id} data-darkmode={d} className="overflow-hidden rounded-xl border font-sans">
                  <Sample />
                </div>
              </figure>
            )),
          )}
        </div>
      </Section>

      <Section title="Colour tokens">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
          {COLOR_TOKENS.map((t) => (
            <div key={t} className="flex items-center gap-3 text-sm">
              <span className="size-8 shrink-0 rounded-md border" style={{ background: `var(--${t})` }} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{t}</span>
              <span className="text-xs text-muted-foreground tabular">{tokenContrast(t)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type, shape, density, elevation">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            {[...TEXT_SIZES].reverse().map((s) => (
              <p key={s} className={`text-${s} truncate`}>
                <span className="mr-3 inline-block w-10 font-mono text-xs text-muted-foreground">{s}</span>
                Steady Wi-Fi under load, 18 ms
              </p>
            ))}
          </div>
          <div className="flex flex-wrap content-start gap-4">
            {(['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-full'] as const).map((r) => (
              <div
                key={r}
                className={cn('flex size-20 items-end border bg-card p-1.5 font-mono text-xs text-muted-foreground', r)}
              >
                {r.replace('rounded-', '')}
              </div>
            ))}
            {(['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg'] as const).map((s) => (
              <div
                key={s}
                className={cn('flex size-20 items-end rounded-lg bg-card p-1.5 font-mono text-xs text-muted-foreground', s)}
              >
                {s.replace('shadow-', '')}
              </div>
            ))}
            <div className="flex items-end gap-1">
              {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                <div
                  key={n}
                  className="bg-primary"
                  style={{ width: `calc(var(--spacing) * ${n})`, height: `calc(var(--spacing) * ${n})` }}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Buttons, fields and choices">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Save &amp; apply</Button>
          <Button variant="outline">Discard</Button>
          <Button variant="secondary">Scan now</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Factory reset</Button>
          <Button variant="link">All devices</Button>
          <Button disabled>Unavailable</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
        <Card className="py-2">
          <CardContent className="divide-y">
            <Field id="sp-name" label="Network name" hint="What devices see when they look for Wi-Fi.">
              <Input id="sp-name" defaultValue="MilkFlint" />
            </Field>
            <Field
              id="sp-vlan"
              label="VLAN ID"
              hint="Only if your provider asks for one, e.g. 10 or 35. Leave it empty otherwise: most lines need none and a wrong one stops the internet working."
            >
              <Input id="sp-vlan" placeholder="None" />
            </Field>
            <Field
              id="sp-bad"
              label="Router address"
              hint="Its address on your network."
              error="That's inside the guest network's range."
            >
              <Input id="sp-bad" aria-invalid defaultValue="192.168.9.1" />
            </Field>
            <Field id="sp-sel" label="Channel width" hint="Wider is faster, narrower reaches further.">
              <Select defaultValue="80">
                <SelectTrigger id="sp-sel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 MHz</SelectItem>
                  <SelectItem value="40">40 MHz</SelectItem>
                  <SelectItem value="80">80 MHz</SelectItem>
                  <SelectItem value="160">160 MHz</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="sp-off" label="Switches" hint="On, off, and two that can't be changed.">
              <div className="flex items-center gap-4">
                <Switch aria-label="On" defaultChecked />
                <Switch aria-label="Off" />
                <Switch aria-label="On, locked" defaultChecked disabled />
                <Switch aria-label="Off, locked" disabled />
                <Input className="max-w-40" aria-label="Locked field" disabled defaultValue="Set by LuCI" />
              </div>
            </Field>
          </CardContent>
        </Card>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">5 GHz: 6</Badge>
          <Badge variant="outline">WPA3</Badge>
          <Badge variant="success">Online</Badge>
          <Badge variant="warning">Busy</Badge>
          <Badge variant="destructive">Lost</Badge>
          <Badge variant="info">Scanning</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>Only listening</AlertTitle>
            <AlertDescription>While a band scans, its devices can&apos;t send or receive for a second or two.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <CircleCheckIcon />
            <AlertTitle>Saved and applied</AlertTitle>
          </Alert>
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Your devices will reconnect</AlertTitle>
            <AlertDescription>Changing the password drops every device on this band until it rejoins.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Couldn&apos;t save</AlertTitle>
            <AlertDescription>The firewall wouldn&apos;t load the change, so it was undone.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section title="Data">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                  <TableHead className="text-right">Signal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ['Smart TV', '5 GHz', '312 Mbit/s', '−58 dBm'],
                    ['Laptop', '5 GHz', '41 Mbit/s', '−49 dBm'],
                    ['Old tablet', '2.4 GHz', '0.4 Mbit/s', '−71 dBm'],
                  ] as const
                ).map(([d, b, r, s]) => (
                  <TableRow key={d}>
                    <TableCell className="font-medium">{d}</TableCell>
                    <TableCell>{b}</TableCell>
                    <TableCell className="text-right">{r}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{s}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card className="gap-3">
            <CardHeading title="Internet" description="Live, from the WAN port" />
            <CardContent>
              <InfoRow label="Public address">203.0.113.24</InfoRow>
              <InfoRow label="Up for">12 d 4 h</InfoRow>
              <InfoRow label="Line">500 / 50 Mbit/s</InfoRow>
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {SERIES.map((n) => (
              <div key={n} className="flex flex-1 flex-col gap-1">
                <span className="h-6 rounded-md" style={{ background: `var(--chart-${n})` }} />
                <span className="font-mono text-xs text-muted-foreground">chart-{n}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            {RAMP.map((n) => (
              <span key={n} className="h-4 flex-1 rounded-sm" style={{ background: `var(--ramp-${n})` }} />
            ))}
          </div>
          <Skeleton className="h-10" />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open a dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Erase everything and restart?</DialogTitle>
                <DialogDescription>Wi-Fi will be off afterwards: you&apos;ll need a cable to sign in again.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button variant="destructive">Erase and restart</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <SheetSample />
        </div>
        <SaveBar visible busy={false} invalid={false} onSave={() => undefined} onRevert={() => undefined} />
      </Section>
    </div>
  );
}

function SheetSample(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open a sheet
      </Button>
      <SheetContent>
        <div className="flex flex-col gap-1 border-b px-6 py-5">
          <SheetTitle>Allow-ISAKMP</SheetTitle>
          <SheetDescription>Internet → Forwarded traffic</SheetDescription>
        </div>
        <div className="px-6 py-4 text-sm text-muted-foreground">The rule&apos;s settings go here.</div>
      </SheetContent>
    </Sheet>
  );
}
