// The Firewall page: OpenWrt's firewall (fw4) as traffic rules and zones,
// covering what LuCI's firewall pages do apart from port forwards, which
// have a page of their own. It opens on the answer (what the internet can
// reach, whose rules there are), from the live config. Everything is read
// and written through UCI, as LuCI does; the hit counts come from the
// running ruleset and the warnings from fw4's own check. The tab is in the
// URL (#/firewall/zones), so links and the back button land on it; the old
// #/firewall/forwards goes to the Port forwards page.
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';
import { type ReactElement, useEffect } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { useLive } from '@/lib/query/use-live';
import { pageLink, tabFrom, tabLink, useSubPath } from '@/lib/router';
import { FirewallAnswer } from './answer';
import { FirewallDialogs } from './dialogs';
import { firewallQueries } from './queries';
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

export function FirewallPage(): ReactElement {
  const sub = useSubPath();
  const tab = tabFrom(sub, tabs, 'rules');
  const navigate = useNavigate();
  const goTo = (t: Tab): void => {
    void navigate(tabLink('firewall', t, 'rules'));
  };
  // port forwards were a tab here: old links and bookmarks land on their page
  useEffect(() => {
    if (sub === 'forwards') void navigate({ ...pageLink('port-forwards'), replace: true });
  }, [sub, navigate]);
  return (
    <>
      <PageHeader title="Firewall" description="What may reach the router and your devices, and what they may reach." />
      <PageBoundary>
        <Firewall tab={tab} goTo={goTo} />
      </PageBoundary>
    </>
  );
}

// a save refreshes every read (useApply): nothing more to do here
const noop = (): void => undefined;

function Firewall({ tab, goTo }: { tab: Tab; goTo: (t: Tab) => void }): ReactElement {
  const { data } = useSuspenseQuery(firewallQueries.config());
  const counters = useLive(firewallQueries.counters());
  const mappings = useLive(firewallQueries.upnpMappings());
  const warnings = useLive(firewallQueries.warnings());
  const { state, actions, dialog, setDialog, save, submit, applyNow } = useFirewallActions(noop);

  return (
    <div className="flex flex-col gap-4">
      <ApplyStatus state={state} />
      <CheckWarnings warnings={warnings.data} />
      <FirewallAnswer data={data} upnp={mappings.data?.length ?? 0} />
      <p className="text-sm text-muted-foreground">
        Opening a port for a game or a camera?{' '}
        <Link {...pageLink('port-forwards')} className="inline-flex items-center gap-0.5 font-medium link underline-offset-4">
          Port forwards
          <ChevronRightIcon className="size-4" />
        </Link>
      </p>
      <Tabs label="Firewall" prefix="fw" items={tabs} value={tab} onChange={goTo} className="mt-2" />
      {/* every tab stays mounted, so unsaved zone edits survive a look at another tab */}
      <TabPanel prefix="fw" id="rules" value={tab}>
        <RulesTable data={data} counters={counters.data} actions={actions} />
      </TabPanel>
      <TabPanel prefix="fw" id="zones" value={tab}>
        <ZonesTab data={data} counters={counters.data} actions={actions} onSubmit={applyNow} />
      </TabPanel>
      <FirewallDialogs
        dialog={dialog}
        data={data}
        confirm={actions.confirm}
        onClose={() => {
          setDialog(undefined);
        }}
        onSave={save}
        onSubmit={submit}
      />
    </div>
  );
}
