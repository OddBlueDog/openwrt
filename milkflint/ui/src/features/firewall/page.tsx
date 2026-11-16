// The Firewall page: OpenWrt's firewall (fw4) as traffic rules and zones,
// covering what LuCI's firewall pages do apart from port forwards, which
// have a page of their own. It opens on the answer (what the internet can
// reach, whose rules there are), from the live config. Everything is read
// and written through UCI, as LuCI does; the hit counts come from the
// running ruleset and the warnings from fw4's own check. The tab is in the
// URL (#/firewall/zones), so links and the back button land on it; the old
// #/firewall/forwards goes to the Port forwards page.
import { ChevronRightIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useSyncExternalStore } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { href } from '@/lib/router';
import { FirewallAnswer } from './answer';
import { getCounters, getUpnpMappings, getWarnings, loadFirewall } from './api';
import { FirewallDialogs } from './dialogs';
import { RulesTable } from './rules-table';
import { useFirewallActions } from './use-actions';
import { CheckWarnings } from './warnings';
import { ZonesTab } from './zones';
import { TabPanel, Tabs } from '@/components/ui/tabs';

type Tab = 'rules' | 'zones';

const tabs: readonly { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'zones', label: 'Zones' },
];

function subPath(): string {
  return window.location.hash.replace(/^#\/?/, '').split('/')[1] ?? '';
}

function currentTab(): Tab {
  const name = subPath();
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

export function FirewallPage(): ReactElement {
  const tab = useSyncExternalStore(subscribe, currentTab);
  const sub = useSyncExternalStore(subscribe, subPath);
  // port forwards were a tab here: old links and bookmarks land on their page
  useEffect(() => {
    if (sub === 'forwards') window.location.replace(href('port-forwards'));
  }, [sub]);
  const { data, error, loading, reload } = useLoad(loadFirewall);
  const counters = usePoll(
    async () => (data === undefined ? undefined : getCounters()),
    10_000,
    data === undefined ? '' : 'loaded',
  );
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
        <ApplyStatus state={state} />
        <CheckWarnings warnings={warnings.data} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          data !== undefined && (
            <>
              <FirewallAnswer data={data} upnp={mappings.data?.length ?? 0} />
              <p className="text-sm text-muted-foreground">
                Opening a port for a game or a camera?{' '}
                <a href={href('port-forwards')} className="inline-flex items-center gap-0.5 font-medium link underline-offset-4">
                  Port forwards
                  <ChevronRightIcon className="size-4" />
                </a>
              </p>
              <Tabs label="Firewall" prefix="fw" items={tabs} value={tab} onChange={goTo} className="mt-2" />
              {/* every tab stays mounted, so unsaved zone edits survive a look at another tab */}
              <TabPanel prefix="fw" id="rules" value={tab}>
                <RulesTable data={data} counters={counters.data} actions={actions} />
              </TabPanel>
              <TabPanel prefix="fw" id="zones" value={tab}>
                <ZonesTab data={data} counters={counters.data} actions={actions} />
              </TabPanel>
              <FirewallDialogs
                dialog={dialog}
                data={data}
                confirm={actions.confirm}
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
