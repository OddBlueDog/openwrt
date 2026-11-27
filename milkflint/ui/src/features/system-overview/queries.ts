// What About this router reads (see ARCHITECTURE.md).
import { getInterfaces, type NetworkInterface } from '@/lib/api/network';
import { getStats, type Stats } from '@/lib/api/stats';
import { type Board, getBoard, getInfo, type SystemInfo } from '@/lib/api/system';
import { type LiveQuery, liveQuery, type RouterQuery, staticQuery } from '@/lib/query/options';

export interface Overview {
  info: SystemInfo;
  stats: Stats;
  interfaces: NetworkInterface[];
}

async function getOverview(): Promise<Overview> {
  const [info, stats, interfaces] = await Promise.all([getInfo(), getStats(), getInterfaces()]);
  return { info, stats, interfaces };
}

export const systemQueries = {
  /** the board, the firmware and the host name: once a session */
  board: (): RouterQuery<Board> => staticQuery(['system-overview', 'board'], getBoard),
  /** memory, load, temperatures and the interfaces, every 3 s */
  overview: (): LiveQuery<Overview> => liveQuery(['system-overview', 'overview'], getOverview, 3000),
};
