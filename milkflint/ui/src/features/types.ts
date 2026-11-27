import type { QueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { FeatureId } from './ids';

/** Menu groups, by task. A group with no pages is hidden. */
export type GroupId = 'devices' | 'wifi' | 'speed' | 'network' | 'security' | 'vpn' | 'system' | 'advanced';

/** The menu's three bands: everyday tasks, things set up once, the router itself. */
export type Band = 'everyday' | 'setup' | 'router';

export interface Group {
  id: GroupId;
  title: string;
  icon: LucideIcon;
  /** Position in the menu, on the same scale as top-level pages' order. */
  order: number;
  band: Band;
}

/**
 * One page of the interface. Its folder holds the page, its API calls
 * (api.ts) and this description; its router side, if any, lives in
 * source/feed/milkflint-ui/files/features/<id>/.
 */
export interface Feature {
  id: FeatureId;
  title: string;
  /** One line under the page title. */
  description: string;
  icon: LucideIcon;
  /** Omitted: a top-level entry. */
  group?: GroupId;
  /** Position within its group (or in the menu, among top-level pages and groups). */
  order: number;
  /** Only for the main router: out of the menu in access point mode, where another router does it. */
  routerOnly?: true;
  /** Out of the menu (and its search) but still reachable at its route: a page folded into another. */
  inMenu?: false;
  page: LazyExoticComponent<ComponentType>;
  /**
   * Starts the page's first read (queryClient.prefetchQuery) while its code
   * loads, or when a link to it is hovered. Never awaited: a slow router
   * doesn't hold the page's own skeleton back.
   */
  prefetch?: (client: QueryClient) => void;
}
