// Security → banIP: blocking addresses known for attacks (banIP's feeds),
// countries and networks, and your own allowlist and blocklist, at the
// router's firewall. The status at the top (with its lookup and the day of
// drops), then Protection (how much to block), Lists (your own) and
// Activity (what's been blocked); everything else in the Advanced sheet.
// banIP does the work (its own nftables table); the router side is
// source/feed/milkflint-ui/files/features/banip.
import { InfoIcon, SlidersHorizontalIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ApplyState } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { cn, errorMessage } from '@/lib/utils';
import { ActivityTab } from './activity';
import { AdvancedSheet } from './advanced-sheet';
import { enableBanip, getConfig, getStatus, runAction, saveOptions } from './api';
import { ListsTab } from './lists';
import { ProtectionTab } from './protection';
import { PRESETS } from './feeds';
import { plainFeeds } from './model';
import type { Options } from './options';
import { StatusCard } from './status-card';

type TabId = 'protection' | 'lists' | 'activity';
const TABS: { id: TabId; label: string }[] = [
  { id: 'protection', label: 'Protection' },
  { id: 'lists', label: 'Your lists' },
  { id: 'activity', label: 'Activity' },
];

export function BanipPage(): ReactElement {
  const status = usePoll(getStatus, 3000);
  const config = useLoad(getConfig);
  const [tab, setTab] = useState<TabId>('protection');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
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
          <InfoIcon />
          <AlertTitle>Not in this firmware</AlertTitle>
          <AlertDescription>banIP’s package isn’t installed on this router.</AlertDescription>
        </Alert>
      </>
    );
  }

  // the settings as saved: when they change (a save), the tabs' drafts start again from them
  const version = JSON.stringify([c.options, c.milkflint, c.custom, (c.catalogue ?? []).map((f) => f.name)]);

  const toggle = (on: boolean): void => {
    if (!on) {
      run('toggle', () => enableBanip(false), 'banIP is off: nothing is blocked, and its rules are gone.');
      return;
    }
    // nothing chosen yet: the recommended lists, rather than nothing
    const empty = plainFeeds(c.options ?? {}).length === 0 && (c.options?.['ban_feed'] ?? []).length === 0;
    const recommended = PRESETS.find((p) => p.id === 'recommended')?.feeds ?? [];
    run(
      'toggle',
      async () => {
        if (empty) await saveOptions({ ban_feed: [...recommended] }, { preset: 'recommended' });
        await enableBanip(true);
      },
      empty ? 'banIP is on, with the Recommended lists: it’s downloading and loading them now.' : 'banIP is on: it’s loading the lists now.',
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
              Another router faces the internet and filters what reaches your network, so banIP stays off here. Run it on that router.
            </AlertDescription>
          </Alert>
        )}
        <StatusCard
          s={s}
          busy={busy}
          conntrack={c.tools?.conntrack === true}
          onToggle={toggle}
          onUpdate={() => {
            run('update', () => runAction('reload'), 'Updating: banIP downloads every list again, then loads the ones that changed.');
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
            <div role="tablist" aria-label="banIP" className="flex w-full overflow-x-auto rounded-lg border bg-muted/50 p-1 sm:w-fit">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`banip-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`banip-panel-${t.id}`}
                  onClick={() => {
                    setTab(t.id);
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
            {/* every tab stays mounted, so unsaved edits survive a look at another */}
            <div id="banip-panel-protection" role="tabpanel" aria-labelledby="banip-tab-protection" hidden={tab !== 'protection'}>
              <ProtectionTab key={version} c={c} s={s} onSaved={reload} />
            </div>
            <div id="banip-panel-lists" role="tabpanel" aria-labelledby="banip-tab-lists" hidden={tab !== 'lists'}>
              <ListsTab key={version} c={c} onSaved={reload} />
            </div>
            <div id="banip-panel-activity" role="tabpanel" aria-labelledby="banip-tab-activity" hidden={tab !== 'activity'}>
              {tab === 'activity' && <ActivityTab c={c} s={s} onSaved={reload} />}
            </div>
          </>
        )}
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
            run('advanced', () => saveOptions(changes), c.enabled === true ? 'Saved. banIP restarts with them, keeping the lists it has.' : 'Saved.');
          }}
        />
      )}
    </>
  );
}
