// What the DNS page reads (see ARCHITECTURE.md).
import type { AdGuardStatus } from '../adguardhome/api';
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type DnsStatus, getDnsStatus, loadAdGuard, loadDns } from './api';
import type { DnsData } from './model';

export const dnsQueries = {
  settings: (): RouterQuery<DnsData> => settingsQuery(['dns', 'settings'], loadDns),
  /** whether dnsproxy is installed and running, and a DNS program set up outside MilkFlint, every 5 s */
  status: (): LiveQuery<DnsStatus> => liveQuery(['dns', 'status'], getDnsStatus, 5000),
  /** AdGuard Home on the router, filtering in front of these settings */
  adguard: (): RouterQuery<AdGuardStatus | null> => settingsQuery(['dns', 'adguard'], loadAdGuard),
};
