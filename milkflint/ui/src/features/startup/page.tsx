// Startup: LuCI's System → Startup. Services: every script in /etc/init.d
// in start order, whether procd runs it now, whether it starts at boot (a
// switch), and Start, Restart, Reload and Stop; stopping or turning off one
// the router can't do without asks first, saying what would go. Local
// startup: /etc/rc.local, the commands run once the router has started.
// The tab is in the address (#/startup/local).
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircleIcon, SearchIcon, TerminalIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { PageBoundary } from '@/components/page-boundary';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { ApplyState } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { tabFrom, tabLink, useSubPath } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { type InitAction, RC_LOCAL } from './api';
import { consequence, describeService, rcLocalFormSchema, rcLocalText, type Service } from './model';
import { startupQueries, useRunInit, useSaveRcLocal } from './queries';

type Tab = 'services' | 'local';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'local', label: 'Local startup' },
];

const RUN: readonly { action: InitAction; label: string }[] = [
  { action: 'start', label: 'Start' },
  { action: 'restart', label: 'Restart' },
  { action: 'reload', label: 'Reload' },
  { action: 'stop', label: 'Stop' },
];

const done: Readonly<Record<InitAction, string>> = {
  start: 'Started',
  restart: 'Restarted',
  reload: 'Reloaded',
  stop: 'Stopped',
  enable: 'Starts at boot:',
  disable: 'Off at boot:',
};

/** procd says whether it runs now only for the services it keeps running; the others run once. */
function Now({ s }: { s: Service }): ReactElement {
  if (s.running === true) return <Badge variant="success">Running</Badge>;
  return <span className="text-xs text-muted-foreground">{s.running === false ? 'Not running' : 'Runs once'}</span>;
}

const orderOf = (s: Service): ReactElement => (
  <span className="text-muted-foreground tabular">{s.start === undefined ? '–' : String(s.start).padStart(2, '0')}</span>
);

function ServiceName({ s }: { s: Service }): ReactElement {
  const what = describeService(s.name);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium">{s.name}</span>
      {what !== undefined && <span className="text-xs text-muted-foreground">{what}</span>}
    </span>
  );
}

/** What it's doing: one action of one service at a time. */
interface Pending {
  name: string;
  action: InitAction;
}

function ServicesTab({ onStatus }: { onStatus: (s: ApplyState) => void }): ReactElement {
  const { data: all } = useSuspenseQuery(startupQueries.services());
  const { mutateAsync } = useRunInit();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<Pending>();
  const [asking, setAsking] = useState<Pending>();

  const run = useCallback(
    async ({ name, action }: Pending): Promise<void> => {
      setAsking(undefined);
      setPending({ name, action });
      onStatus({ phase: 'applying' });
      try {
        // procd starts and stops in the background: the list is read again a second later
        await mutateAsync({ name, action });
        onStatus({ phase: 'done', nothingChanged: false, title: `${done[action]} ${name}` });
      } catch (err) {
        onStatus({ phase: 'failed', title: `Couldn’t ${action} ${name}`, message: errorMessage(err) });
      } finally {
        setPending(undefined);
      }
    },
    [onStatus, mutateAsync],
  );
  // stopping one the router needs, or turning it off at boot, asks first
  const ask = useCallback(
    (p: Pending): void => {
      if ((p.action === 'stop' || p.action === 'disable') && consequence(p.name) !== undefined) setAsking(p);
      else void run(p);
    },
    [run],
  );

  // the parts of a row, for the table's cells and a narrow screen's cards
  const parts = useMemo(() => {
    const busy = pending !== undefined;
    return {
      boot: (s: Service): ReactElement => (
        <Switch
          checked={s.enabled}
          disabled={busy}
          aria-label={`${s.name} starts at boot`}
          onCheckedChange={(on) => {
            ask({ name: s.name, action: on ? 'enable' : 'disable' });
          }}
        />
      ),
      run: (s: Service): ReactElement => (
        <div className="flex flex-wrap justify-end gap-1">
          {RUN.map(({ action, label }) => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              aria-label={`${label} ${s.name}`}
              onClick={() => {
                ask({ name: s.name, action });
              }}
            >
              {pending?.name === s.name && pending.action === action && <LoaderCircleIcon className="animate-spin" />}
              {label}
            </Button>
          ))}
        </div>
      ),
    };
  }, [pending, ask]);

  const columns = useMemo(
    (): readonly Column<Service>[] => [
      { label: 'Order', cell: orderOf, sort: (s) => s.start, title: 'Its place in the start order at boot', className: 'w-16' },
      { label: 'Service', cell: (s) => <ServiceName s={s} />, sort: (s) => s.name },
      { label: 'Now', cell: (s) => <Now s={s} />, sort: (s) => (s.running === undefined ? undefined : s.running ? 0 : 1) },
      { label: 'At boot', cell: parts.boot, sort: (s) => (s.enabled ? 0 : 1) },
      { label: 'Run', hidden: true, cell: parts.run, className: 'text-right' },
    ],
    [parts],
  );

  const words = filter.trim().toLowerCase();
  const rows = words === '' ? all : all.filter((s) => `${s.name} ${describeService(s.name) ?? ''}`.toLowerCase().includes(words));
  const atBoot = all.filter((s) => s.enabled).length;
  const running = all.filter((s) => s.running === true).length;
  const stopping = asking === undefined ? undefined : consequence(asking.name);

  return (
    <Card className="pb-0">
      <CardHeading
        title="Services"
        description="What the router runs, from /etc/init.d. A switch changes what starts at the next boot; Start and Stop act now."
        status={`${String(atBoot)} of ${String(all.length)} start at boot · ${String(running)} running now`}
        action={
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Find a service"
              placeholder="Find a service"
              className="h-8 w-48 pl-8"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
          </div>
        }
      />
      <DataTable
        label="Services"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.name}
        empty={words === '' ? 'No services.' : `No service matches “${filter.trim()}”.`}
        initialSort={{ id: 'Order', desc: false }}
        card={(s) => (
          <div className="flex flex-col gap-2 px-5 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <ServiceName s={s} />
              {parts.boot(s)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Order {orderOf(s)}</span>
                <Now s={s} />
              </span>
              {parts.run(s)}
            </div>
          </div>
        )}
        framed={false}
        inset
        wide="lg"
      />
      <Dialog
        open={asking !== undefined}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {asking?.action === 'disable' ? `Turn ${asking.name} off at boot?` : `Stop ${asking?.name ?? ''}?`}
            </DialogTitle>
            <DialogDescription>
              {stopping}{' '}
              {asking?.action === 'disable'
                ? 'From the next boot on, until it’s turned back on: the router may not be reachable to do that.'
                : 'Until it’s started again, or the router restarts.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setAsking(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (asking !== undefined) void run(asking);
              }}
            >
              {asking?.action === 'disable' ? 'Turn off at boot' : 'Stop'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LocalStartupTab({ onStatus }: { onStatus: (s: ApplyState) => void }): ReactElement {
  const { data: saved } = useSuspenseQuery(startupQueries.rcLocal());
  const write = useSaveRcLocal();
  const settings = useSettingsForm({
    schema: rcLocalFormSchema,
    saved: { text: saved },
    onSave: async ({ text }) => {
      onStatus({ phase: 'applying' });
      try {
        await write.mutateAsync({ text: rcLocalText(text), before: saved });
        onStatus({ phase: 'done', nothingChanged: false, note: 'It runs at the next boot.' });
      } catch (err) {
        onStatus({ phase: 'failed', message: errorMessage(err) });
      }
    },
  });
  const { form } = settings;
  const { text } = useFormValues(form);
  return (
    <Card>
      <CardHeading
        title="Local startup"
        description={
          <>
            Commands of your own, run once as root when the router has started:{' '}
            <span className="font-mono text-xs">{RC_LOCAL}</span>. Put them before{' '}
            <span className="font-mono text-xs">exit 0</span>.
          </>
        }
      />
      <CardContent className="flex flex-col gap-3">
        <form.Field name="text">
          {(field) => (
            <Textarea
              value={field.state.value}
              rows={16}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={RC_LOCAL}
              className="font-mono text-xs"
              onChange={(e) => {
                field.handleChange(e.target.value);
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <Note tone="info" icon={<TerminalIcon />}>
          A command that keeps running holds up the rest of the start (the lights, the clock): end it with{' '}
          <span className="font-mono text-xs">&amp;</span> to run it in the background.
        </Note>
      </CardContent>
      <SaveBar
        // what's written: Unix line ends and one newline at the end, so only a real change shows
        visible={rcLocalText(text) !== rcLocalText(saved)}
        busy={write.isPending}
        invalid={false}
        onSave={settings.save}
        onRevert={settings.discard}
      />
    </Card>
  );
}

export function StartupPage(): ReactElement {
  const navigate = useNavigate();
  const tab = tabFrom(useSubPath(), TABS, 'services');
  const [status, setStatus] = useState<ApplyState>({ phase: 'idle' });
  return (
    <>
      <PageHeader title="Startup" description="The services the router runs, and your own commands at boot." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={status} />
        <Tabs
          label="Startup"
          prefix="startup"
          items={TABS}
          value={tab}
          onChange={(t) => {
            void navigate(tabLink('startup', t, 'services'));
          }}
        />
        <TabPanel prefix="startup" id="services" value={tab}>
          <PageBoundary>
            <ServicesTab onStatus={setStatus} />
          </PageBoundary>
        </TabPanel>
        <TabPanel prefix="startup" id="local" value={tab}>
          <PageBoundary>
            <LocalStartupTab onStatus={setStatus} />
          </PageBoundary>
        </TabPanel>
      </div>
    </>
  );
}
