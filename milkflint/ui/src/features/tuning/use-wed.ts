// Whether hardware offloading with Wireless Ethernet Dispatch (./wed.ts) is
// on, for the pages whose settings it turns off or passes by, and the changes
// that turn it off again with a page's own save.
import { useCallback } from 'react';
import { useLoad } from '@/hooks/use-load';
import { type Change, getConfig, type Section } from '@/lib/api/uci';
import { type WedConfig, wedOffChanges, wedOn } from './wed';

export interface Wed {
  /** the setting is on; false until it's known */
  on: boolean;
  /** the changes that turn it off and put back what it turned off, for a page's own save */
  offChanges: (options?: { keepFirewall?: boolean }) => Change[];
  /** read the settings again, after a save */
  reload: () => void;
}

async function loadWed(): Promise<WedConfig> {
  const [milkflint, sqm, firewall] = await Promise.all([
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('sqm').catch((): Section[] => []),
    getConfig('firewall').catch((): Section[] => []),
  ]);
  return { milkflint, sqm, firewall };
}

/** Whether WED is on, and how to turn it off with a page's save. */
export function useWed(): Wed {
  const { data, reload } = useLoad(loadWed);
  const offChanges = useCallback(
    (options?: { keepFirewall?: boolean }) => (data === undefined ? [] : wedOffChanges(data, options)),
    [data],
  );
  return { on: data !== undefined && wedOn(data.milkflint), offChanges, reload };
}
