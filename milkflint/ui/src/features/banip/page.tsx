// Security → banIP: blocking addresses known for attacks (banIP's feeds),
// countries and networks, and your own allowlist and blocklist, at the
// router's firewall. The status at the top (with its lookup and the day of
// drops), then Protection (how much to block), Lists (your own) and
// Activity (what's been blocked); everything else in the Advanced sheet.
// banIP does the work (its own nftables table); the router side is
// source/feed/milkflint-ui/files/features/banip.
import { ArrowUpCircleIcon, ChevronRightIcon, InfoIcon, PackageXIcon, SlidersHorizontalIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { ApplyState } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { href, tabFrom, tabHref, useSubPath } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { ActivityTab } from './activity';
import { AdvancedSheet } from './advanced-sheet';
import { enableBanip, getConfig, getStatus, runAction, saveOptions } from './api';
import { ListsTab } from './lists';
import { ProtectionTab } from './protection';
import { PRESETS, type PresetId } from './feeds';
import { plainFeeds, withPreset } from './model';
import type { Options } from './options';
import { StatusCard } from './status-card';
import { LicenseCard } from './license-card';

type TabId = 'protection' | 'lists' | 'activity';
const TABS: { id: TabId; label: string }[] = [
  { id: 'protection', label: 'Protection' },
  { id: 'lists', label: 'Your lists' },
  { id: 'activity', label: 'Activity' },
];

export function BanipPage(): ReactElement {
  const status = usePoll(getStatus, 3000);
  const config = useLoad(getConfig);
  // the tab is in the address (#/banip/activity), so a link or the menu's search opens it
  const tab = tabFrom(useSubPath(), TABS, 'protection');
  const setTab = (t: TabId): void => {
    window.location.hash = tabHref('banip', t, 'protection');
  };
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  // the preset card picked under Protection and not saved yet: turning banIP on starts it
  const [pick, setPick] = useState<PresetId>();
  const s = status.data;
  const c = config.data;

  const reload = (): void => {
    config.reload();
    status.refresh();
  };
  const run = (what: string, fn: () => Promise<unknown>, note?: string): void => {
    setBusy(what);
    setState({ phase: 'applying' });
    fn().then(
      () => {
        setBusy(undefined);
        setState({ phase: 'done', nothingChanged: false, note });
        reload();
      },
      (err: unknown) => {
        setBusy(undefined);
        setState({ phase: 'failed', message: errorMessage(err) });
        status.refresh();
      },
    );
  };

  const header = (
    <PageHeader
      title="banIP"
      description="Blocks connections from addresses known for attacks, and to the ones your devices should never reach, at the router."
      actions={
        c?.installed === true && c.mode !== 'ap' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAdvanced(true);
            }}
          >
            <SlidersHorizontalIcon /> Advanced
          </Button>
        ) : undefined
      }
    />
  );
  if (s === undefined || c === undefined) {
    const err = status.error ?? config.error;
    return (
      <>
        {header}
        {err !== undefined && !status.loading && !config.loading ? (
          <LoadError
            error={err}
            retry={() => {
              status.refresh();
              config.reload();
            }}
          />
        ) : (
          <FormSkeleton />
        )}
      </>
    );
  }
  if (!s.installed || !c.installed) {
    return (
      <>
        {header}
        <Alert>
          <PackageXIcon />
          <AlertTitle>Not in this firmware</AlertTitle>
          <AlertDescription>
            <p>
              banIP’s package isn’t installed on this router. MilkFlint’s images include it, off until you turn it on: install the
              newest release to get it.
            </p>
            <Button size="sm" variant="outline" className="mt-2" asChild>
              <a href={href('upgrade')}>
                <ArrowUpCircleIcon /> Upgrade
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  // the settings as saved: when they change (a save), the tabs' drafts start again from them
  const version = JSON.stringify([c.options, c.milkflint, c.custom, (c.catalogue ?? []).map((f) => f.name)]);

  // nothing chosen yet: turning it on starts the recommended lists, rather than nothing
  const empty = plainFeeds(c.options ?? {}).length === 0 && (c.options?.['ban_feed'] ?? []).length === 0;
  const toggle = (on: boolean): void => {
    if (!on) {
      run('toggle', () => enableBanip(false), 'banIP is off: nothing is blocked, and its rules are gone.');
      return;
    }
    // a preset card picked under Protection and not saved yet wins; with nothing chosen at all, Recommended
    const want = pick === 'recommended' || pick === 'strict' ? pick : empty ? 'recommended' : undefined;
    const title = PRESETS.find((p) => p.id === want)?.title;
    run(
      'toggle',
      async () => {
        if (want !== undefined) {
          const o = withPreset(c.options ?? {}, want);
          const lists: Options = {};
          for (const k of ['ban_feed', 'ban_feedin', 'ban_feedout', 'ban_feedinout', 'ban_feedreset'] as const) {
            const v = o[k];
            if (v !== undefined) lists[k] = v;
          }
          await saveOptions(lists, { preset: want });
        }
        await enableBanip(true);
      },
      title !== undefined
        ? `banIP is on, with the ${title} lists: it’s downloading and loading them now.`
        : 'banIP is on: it’s loading the lists now.',
    );
  };

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {c.mode === 'ap' && (
          <Alert variant="info">
            <InfoIcon />
            <AlertTitle>Not used in access point mode</AlertTitle>
            <AlertDescription>
              <p>
                Another router faces the internet and filters what reaches your network, so banIP stays off here. Run it on that
                router.
              </p>
              <a href={href('mode')} className="mt-1 inline-flex w-fit items-center gap-0.5 font-medium link underline-offset-4">
                Operating mode
                <ChevronRightIcon className="size-4" />
              </a>
            </AlertDescription>
          </Alert>
        )}
        <StatusCard
          s={s}
          busy={busy}
          conntrack={c.tools?.conntrack === true}
          nothingChosen={empty}
          onToggle={toggle}
          onUpdate={() => {
            run(
              'update',
              () => runAction('reload'),
              'Updating: banIP downloads every list again, then loads the ones that changed.',
            );
          }}
          onRestart={() => {
            run('restart', () => runAction('restart'), 'Starting banIP again.');
          }}
          onChanged={() => {
            status.refresh();
          }}
        />
        {c.mode !== 'ap' && (
          <>
            <Tabs label="banIP" prefix="banip" items={TABS} value={tab} onChange={setTab} className="mt-2" />
            {/* Protection and Your lists stay mounted, so unsaved edits survive a look at another tab; Activity polls, so only while it's shown */}
            <TabPanel prefix="banip" id="protection" value={tab}>
              <ProtectionTab key={version} c={c} s={s} onSaved={reload} onPick={setPick} />
            </TabPanel>
            <TabPanel prefix="banip" id="lists" value={tab}>
              <ListsTab key={version} c={c} onSaved={reload} />
            </TabPanel>
            <TabPanel prefix="banip" id="activity" value={tab}>
              {tab === 'activity' && <ActivityTab c={c} s={s} onSaved={reload} />}
            </TabPanel>
          </>
        )}
        <LicenseCard s={s} />
      </div>
      {advanced && (
        <AdvancedSheet
          c={c}
          onClose={() => {
            setAdvanced(false);
          }}
          onChanged={reload}
          onSave={(changes: Options) => {
            setAdvanced(false);
            run(
              'advanced',
              () => saveOptions(changes),
              c.enabled === true ? 'Saved. banIP restarts with them, keeping the lists it has.' : 'Saved.',
            );
          }}
        />
      )}
    </>
  );
}
