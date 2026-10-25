// The Firewall page: OpenWrt's firewall (fw4) in three tabs, traffic rules,
// port forwards and zones, covering what LuCI's firewall pages do.
// Everything is read and written through UCI, as LuCI does; the hit counts
// come from the running ruleset and the warnings from fw4's own check. The
// tab is in the URL (#/firewall/zones), so links and the back button land
// on it.
import { TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useSyncExternalStore } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { cn } from '@/lib/utils';
import { getCounters, getUpnpMappings, getWarnings, loadFirewall } from './api';
import { FirewallDialogs } from './dialogs';
import { BehindNatAlert } from './forwards';
import { ForwardsTable } from './forwards-table';
import { RulesTable } from './rules-table';
import { useFirewallActions } from './use-actions';
import { ZonesTab } from './zones';

type Tab = 'rules' | 'forwards' | 'zones';

const tabs: readonly { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'forwards', label: 'Port forwards' },
  { id: 'zones', label: 'Zones' },
];

function currentTab(): Tab {
  const name = window.location.hash.replace(/^#\/?/, '').split('/')[1] ?? '';
  return tabs.find((t) => t.id === name)?.id ?? 'rules';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

function goTo(tab: Tab): void {
  window.location.hash = tab === 'rules' ? '#/firewall' : `#/firewall/${tab}`;
}

/** What fw4 leaves out of the firewall, so it does nothing: fix it here or in LuCI. */
function Warnings({ warnings }: { warnings: readonly string[] | undefined }): ReactElement | null {
  if (warnings === undefined || warnings.length === 0) return null;
  // fw4 can say several things about one section: count the sections
  const sections = new Set(warnings.map((w) => /^Section (\S+)/.exec(w)?.[1] ?? w)).size;
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{sections === 1 ? 'The firewall skips a setting it can’t use' : `The firewall skips ${String(sections)} settings it can’t use`}</AlertTitle>
      <AlertDescription>
        OpenWrt’s firewall leaves these out, so they do nothing. Edit or delete them here or in LuCI. What it says:
        <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs break-words">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function FirewallPage(): ReactElement {
  const tab = useSyncExternalStore(subscribe, currentTab);
  const { data, error, loading, reload } = useLoad(loadFirewall);
  const counters = usePoll(async () => (data === undefined ? undefined : getCounters()), 10_000, data === undefined ? '' : 'loaded');
  const mappings = usePoll(getUpnpMappings, 15_000);
  const warnings = usePoll(getWarnings, 60_000);
  const refreshCounters = counters.refresh;
  const refreshWarnings = warnings.refresh;
  const onApplied = useCallback(() => {
    reload();
    refreshCounters();
    refreshWarnings();
  }, [reload, refreshCounters, refreshWarnings]);
  const { state, actions, dialog, setDialog, save } = useFirewallActions(onApplied);

  return (
    <>
      <PageHeader title="Firewall" description="What may reach the router and your devices, and what they may reach." />
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Firewall" className="flex w-full overflow-x-auto rounded-lg border bg-muted/50 p-1 sm:w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`fw-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`fw-panel-${t.id}`}
              onClick={() => {
                goTo(t.id);
              }}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors sm:flex-none',
                tab === t.id ? 'bg-card font-medium text-foreground shadow-xs' : 'hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ApplyStatus state={state} />
        <Warnings warnings={warnings.data} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          data !== undefined && (
            <>
              {/* every tab stays mounted, so unsaved zone edits survive a look at another tab */}
              <div id="fw-panel-rules" role="tabpanel" aria-labelledby="fw-tab-rules" hidden={tab !== 'rules'}>
                <RulesTable data={data} counters={counters.data} actions={actions} />
              </div>
              <div id="fw-panel-forwards" role="tabpanel" aria-labelledby="fw-tab-forwards" hidden={tab !== 'forwards'} className="flex flex-col gap-4">
                <BehindNatAlert data={data} />
                <ForwardsTable data={data} counters={counters.data} mappings={mappings.data} actions={actions} />
              </div>
              <div id="fw-panel-zones" role="tabpanel" aria-labelledby="fw-tab-zones" hidden={tab !== 'zones'}>
                <ZonesTab data={data} counters={counters.data} actions={actions} />
              </div>
              <FirewallDialogs
                dialog={dialog}
                data={data}
                onClose={() => {
                  setDialog(undefined);
                }}
                onSave={save}
              />
            </>
          )
        )}
      </div>
    </>
  );
}
