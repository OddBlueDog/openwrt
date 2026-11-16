// All devices: every device the router knows of, opening on how many are
// online and how (Wi-Fi by band, or wired), then the list. A row opens the
// device's side sheet: rename it, reserve its address, and the way to block
// it or see its data usage. Polled every 5 s.
import { SearchIcon, XIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useApply } from '@/hooks/use-apply';
import { usePoll } from '@/hooks/use-poll';
import { href } from '@/lib/router';
import { useRouterMode } from '@/lib/router-mode';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { loadClients } from './api';
import { DeviceSheet } from './device-sheet';
import { DevicesList } from './devices-list';
import { type DeviceCounts, deviceCounts, matches } from './model';

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

function DevicesAnswer({ counts }: { counts: DeviceCounts }): ReactElement {
  const offline = counts.known - counts.online;
  return (
    <Answer columns={3}>
      <AnswerCell
        title="Online now"
        value={
          <>
            <Figure>{counts.online}</Figure>
            <span className="text-sm text-muted-foreground tabular">of {counts.known} known</span>
          </>
        }
      >
        {offline === 0
          ? 'Every device the router knows of.'
          : `${plural(offline, 'other is', 'others are')} offline: seen earlier, or named here.`}
      </AnswerCell>
      <AnswerCell
        title="On Wi-Fi"
        value={<Figure>{counts.wifi}</Figure>}
        action={<GoLink href={href('wifi')}>Wi-Fi networks</GoLink>}
      >
        {counts.bands.length === 0 ? 'None right now.' : counts.bands.map((b) => `${String(b.count)} on ${b.band}`).join(' · ')}
      </AnswerCell>
      <AnswerCell title="Wired" value={<Figure>{counts.wired}</Figure>}>
        Through a LAN port, or a switch or access point behind one.
      </AnswerCell>
    </Answer>
  );
}

export function ClientsPage(): ReactElement {
  const { data, error, loading, refresh } = usePoll(loadClients, 5000);
  const { state, apply } = useApply(refresh);
  const mode = useRouterMode();
  const [editing, setEditing] = useState<string>();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => (data?.devices ?? []).filter((d) => matches(d, query)), [data, query]);
  const counts = useMemo(() => (data === undefined ? undefined : deviceCounts(data.devices)), [data]);
  const editingDevice = data?.devices.find((d) => d.mac === editing);
  const close = useCallback(() => {
    setEditing(undefined);
  }, []);

  return (
    <>
      <PageHeader
        title="All devices"
        description="Every device on your network: rename one, give it a fixed address, or block it."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={refresh} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          data !== undefined &&
          counts !== undefined && (
            <>
              <DevicesAnswer counts={counts} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h2 className="text-base font-semibold">
                  Devices{' '}
                  <span className="text-sm font-normal text-muted-foreground tabular">
                    {query.trim() === ''
                      ? `· ${String(data.devices.length)}`
                      : `· ${String(shown.length)} of ${String(data.devices.length)}`}
                  </span>
                </h2>
                <div className="relative w-full sm:w-72">
                  <SearchIcon
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Search devices"
                    placeholder="Search name, IP or MAC"
                    value={query}
                    className="pl-9"
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </div>
              </div>
              {shown.length > 0 ? (
                <DevicesList devices={shown} busy={state.phase === 'applying'} onEdit={setEditing} />
              ) : (
                <Card className="items-start gap-3 px-5 py-6 text-sm">
                  {query.trim() === '' ? (
                    <>
                      <p className="text-muted-foreground">
                        No devices yet. They show up here when they join the Wi-Fi or plug into a LAN port.
                      </p>
                      <GoLink href={href('wifi')}>Wi-Fi networks</GoLink>
                    </>
                  ) : (
                    <>
                      <p className="text-muted-foreground">No device matches “{query.trim()}”.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQuery('');
                        }}
                      >
                        <XIcon /> Clear the search
                      </Button>
                    </>
                  )}
                </Card>
              )}
            </>
          )
        )}
      </div>
      {editingDevice !== undefined && data !== undefined && (
        <DeviceSheet
          device={editingDevice}
          data={data}
          links={mode !== 'ap'}
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
