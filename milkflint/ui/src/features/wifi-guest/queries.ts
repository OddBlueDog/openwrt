// What the Guest Wi-Fi page reads (see ARCHITECTURE.md).
import { type LiveQuery, liveQuery, type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type Guest, loadAllGuests, loadGuest } from './api';
import type { GuestId } from './guest';
import type { GuestData } from './model';

export const guestQueries = {
  settings: (): RouterQuery<GuestData> => settingsQuery(['wifi-guest', 'settings'], loadGuest),
  /** the devices on every guest network, in one look at the access points, every 5 s */
  clients: (): LiveQuery<Record<GuestId, Guest[]>> => liveQuery(['wifi-guest', 'clients'], loadAllGuests, 5000),
};
