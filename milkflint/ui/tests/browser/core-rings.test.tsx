// Each core's ring (core-rings.tsx) in a real browser: the figure inside it
// stays inside it, in every theme (their text sizes differ) and for every
// figure a core can show, one digit to three.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { describe, expect, test, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-react';
import { CoreRings } from '@/features/dashboard/core-rings';
import { pickableThemes, setThemeId } from '@/lib/theme';
import type * as Ubus from '@/lib/ubus';

// the pretend router in place of lib/ubus.ts's call (choosing a theme saves it), loaded when a call is made: see
// home-fit.test.tsx
vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      const raw = answer('busy', object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

/** Idle to flat out, and the widest two digits. */
const CORES = [0, 0.06, 0.12, 0.88, 0.92, 1];

describe.each(pickableThemes().map((t) => ({ name: t.name, id: t.id })))('$name', ({ id }) => {
  test('every figure is inside its ring', async () => {
    await setThemeId(id);
    const screen = await render(<CoreRings cores={CORES} />);
    const rings = [...screen.container.querySelectorAll('li')];
    expect(rings.length).toBe(CORES.length);
    const out = rings.flatMap((li) => {
      const track = li.querySelector('circle');
      const figure = li.querySelector('text');
      if (track === null || figure === null) return ['a ring without its track or figure'];
      const ring = track.getBoundingClientRect();
      const text = figure.getBoundingClientRect();
      // the ring's inner edge, as drawn: the track's box is its stroke's centre line, the stroke in the SVG's 36 units
      const scale = li.getBoundingClientRect().width / 36;
      const inner = ring.width / 2 - (Number(track.getAttribute('stroke-width')) / 2) * scale;
      const cx = ring.left + ring.width / 2;
      const cy = ring.top + ring.height / 2;
      // the figure's corners are what reach furthest from the middle
      const reach = Math.max(
        ...[text.left, text.right].flatMap((x) => [text.top, text.bottom].map((y) => Math.hypot(x - cx, y - cy))),
      );
      return reach > inner + 0.5
        ? [`“${figure.textContent}” reaches ${reach.toFixed(1)}px from the middle of a ring ${inner.toFixed(1)}px inside`]
        : [];
    });
    expect(out).toEqual([]);
    await cleanup();
  });
});
