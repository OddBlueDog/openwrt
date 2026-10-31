import type { LucideIcon } from 'lucide-react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { FeatureId } from './ids';

/** Sidebar groups. A group with no pages is hidden. */
export type GroupId = 'wifi' | 'network' | 'vpn' | 'flow-control' | 'security' | 'system';

export interface Group {
  id: GroupId;
  title: string;
  icon: LucideIcon;
  /** Position in the menu, on the same scale as top-level pages' order. */
  order: number;
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
  page: LazyExoticComponent<ComponentType>;
}
