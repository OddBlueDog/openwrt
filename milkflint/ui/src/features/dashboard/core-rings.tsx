// Each processor core's use now as a small ring, its share drawn round it
// and the figure inside: the CPU tile and the CPU widget one row tall, where
// a bar per core won't fit. A busy core is drawn in the warning colour and
// says so in its name, not by colour alone. The figure is drawn in the
// ring's own units (the SVG's), not the theme's text size, so it stays
// inside the ring whatever the theme, the font and the figure.
import type { ReactElement } from 'react';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CORE_BUSY } from './model';

// In the ring's 36 units: a thin ring, so the figure has 28 across inside it.
const STROKE = 3;
const RADIUS = 18 - STROKE / 2 - 1;
/** The figure's text size: up to two digits and the "%"; all three digits. */
const FIGURE = 11;
const FIGURE_FULL = 10;
/** "100%" across, at most: inside the ring at the height its digits reach. */
const FIGURE_FULL_WIDTH = 24;

export function CoreRings({ cores, className }: { cores: readonly number[]; className?: string }): ReactElement {
  return (
    <ul aria-label="Each core" className={cn('flex flex-wrap gap-1', className)}>
      {cores.map((c, i) => {
        const share = Math.round(Math.max(0, Math.min(1, c)) * 100);
        const busy = c >= CORE_BUSY;
        const name = `Core ${String(i + 1)}: ${formatPercent(c)}${busy ? ', busy' : ''}`;
        return (
          <li key={i} className="size-9 shrink-0" title={name}>
            <svg viewBox="0 0 36 36" className="size-full" aria-hidden="true">
              <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-muted" />
              {share > 0 && (
                <circle
                  cx="18"
                  cy="18"
                  r={RADIUS}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray={`${String(share)} 100`}
                  // from the top, clockwise
                  transform="rotate(-90 18 18)"
                  className={cn('transition-[stroke-dasharray] duration-base', busy ? 'stroke-warning' : 'stroke-chart-1')}
                />
              )}
              {/* "100%" is held to the width the ring has inside; the shorter figures have room */}
              <text
                x="18"
                y="18"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={share >= 100 ? FIGURE_FULL : FIGURE}
                {...(share >= 100 ? { textLength: FIGURE_FULL_WIDTH, lengthAdjust: 'spacingAndGlyphs' } : {})}
                className={cn('font-medium tabular', busy ? 'fill-warning' : 'fill-foreground')}
              >
                {share}%
              </text>
            </svg>
            <span className="sr-only">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}
