// The widget being drawn, as the registry (widgets.tsx) names it: Home's
// grid provides it, and the cards (widget.tsx, tiles.tsx) take their title
// and icon from it, so each is written once.
import { CircleIcon, type LucideIcon } from 'lucide-react';
import { createContext, useContext } from 'react';
import type { Size } from './layout';

export interface WidgetInfo {
  title: string;
  icon: LucideIcon;
  size: Size;
}

export const WidgetInfoContext = createContext<WidgetInfo>({ title: '', icon: CircleIcon, size: { w: 1, h: 1 } });

export function useWidgetInfo(): WidgetInfo {
  return useContext(WidgetInfoContext);
}
