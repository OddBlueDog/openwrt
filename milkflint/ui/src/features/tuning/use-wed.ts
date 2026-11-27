// Whether hardware offloading with Wireless Ethernet Dispatch (./wed.ts) is
// on, for the pages whose settings it turns off or passes by, and the changes
// that turn it off again with a page's own save. A save refreshes it, as it
// does every read.
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Change } from '@/lib/api/uci';
import { tuningQueries } from './queries';
import { wedOffChanges, wedOn } from './wed';

export interface Wed {
  /** the setting is on; false until it's known */
  on: boolean;
  /** the changes that turn it off and put back what it turned off, for a page's own save */
  offChanges: (options?: { keepFirewall?: boolean }) => Change[];
  /** read the settings again (a save already does) */
  reload: () => void;
}

/** Whether WED is on, and how to turn it off with a page's save. */
export function useWed(): Wed {
  const { data, refetch } = useQuery(tuningQueries.wed());
  const offChanges = useCallback(
    (options?: { keepFirewall?: boolean }) => (data === undefined ? [] : wedOffChanges(data, options)),
    [data],
  );
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);
  return { on: data !== undefined && wedOn(data.milkflint), offChanges, reload };
}
