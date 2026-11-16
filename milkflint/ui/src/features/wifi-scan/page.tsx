// Nearby networks: the Wi-Fi around the router (who shares this router's
// channels, and which are quietest) and, on its second tab, the radar scan
// of the 5 GHz radar channels (which turns 5 GHz off while it listens). The
// tab is in the URL (#/wifi-scan/radar), so links and the back button land
// on it; the old #/radar-scan comes here too. Only the open tab is mounted,
// so each polls the router only while it's shown.
import { type ReactElement, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { href } from '@/lib/router';
import { RadarScanPanel } from '../radar-scan/panel';
import { NearbyNetworks } from './networks';

type Tab = 'networks' | 'radar';

const tabs: readonly { id: Tab; label: string }[] = [
  { id: 'networks', label: 'Networks' },
  { id: 'radar', label: 'Radar scan' },
];

function currentTab(): Tab {
  const name = window.location.hash.replace(/^#\/?/, '').split('/')[1] ?? '';
  return tabs.find((t) => t.id === name)?.id ?? 'networks';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

/** Where a tab lives: #/wifi-scan for the first, #/wifi-scan/radar for the radar scan. */
function tabHref(tab: Tab): string {
  return tab === 'networks' ? href('wifi-scan') : `${href('wifi-scan')}/${tab}`;
}

export function NearbyPage(): ReactElement {
  const tab = useSyncExternalStore(subscribe, currentTab);
  return (
    <>
      <PageHeader
        title="Nearby networks"
        description="The Wi-Fi around the router: who’s on your channels and which are quietest, and a radar scan of 5 GHz."
      />
      <div className="flex flex-col gap-4">
        <Tabs
          label="Nearby networks"
          prefix="nearby"
          items={tabs}
          value={tab}
          onChange={(t) => {
            window.location.hash = tabHref(t);
          }}
        />
        <TabPanel prefix="nearby" id="networks" value={tab}>
          {tab === 'networks' && <NearbyNetworks />}
        </TabPanel>
        <TabPanel prefix="nearby" id="radar" value={tab}>
          {tab === 'radar' && <RadarScanPanel />}
        </TabPanel>
      </div>
    </>
  );
}
