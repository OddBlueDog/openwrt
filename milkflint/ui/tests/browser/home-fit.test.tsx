// Home's widgets in a real browser (Chromium, through Vitest's browser
// mode): every widget at every size it offers, in every theme, for a busy
// router, a quiet one and an access point (fixtures.ts, router.ts), at the
// narrowest Home is with four columns (56rem), with two (42rem) and on a
// phone (20rem). A widget is the size it's given (layout.ts), so nothing it
// draws may reach past its cell, below it or beside it: what doesn't fit
// has to go (fit.ts) or be cut short with an ellipsis.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import type * as Ubus from '@/lib/ubus';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type Editing, HomeGrid } from '@/features/dashboard/home-grid';
import { sizeLabel } from '@/features/dashboard/layout';
import { definition, type HomeData, WIDGET_IDS } from '@/features/dashboard/widgets';
import { pickableThemes, setThemeId } from '@/lib/theme';
import { DEFAULT_THEME_ID } from '@/theme/themes';
import { dashboard, live, type Scenario, SCENARIOS } from './fixtures';
import { answer } from './router';
import { renderWithProviders } from './render';

// the scenario the pretend router answers for; set before each drawing
const router = vi.hoisted(() => ({ scenario: 'busy' }));

// the pretend router in place of lib/ubus.ts's call; loaded when a call is made, not while this mock is being made
// (router.ts loads the fixtures, which load modules that load lib/ubus.ts: it would wait on itself)
vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer: reply } = await import('./router');
      const scenario = SCENARIOS.find((s) => s === router.scenario) ?? 'busy';
      const raw = reply(scenario, object, method, params);
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
  };
});

/** Every widget at every size it offers, each once: one grid holds them all. */
const LAYOUT = WIDGET_IDS.flatMap((id) => definition(id).sizes.map((size, i) => ({ key: `${id}-${String(i)}`, id, size })));

const WIDTHS = [
  { name: 'four columns', width: '56rem' },
  { name: 'two columns', width: '42rem' },
  { name: 'a phone', width: '20rem' },
] as const;

/** The element whose box clips `node`'s overflow, inside the cell, if any (an ellipsis'd line, a chart). */
function clipped(node: Node, cell: Element): boolean {
  for (let el = node.parentElement; el !== null && el !== cell; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true;
  }
  return false;
}

/** What reaches past a cell, if anything: how far, which way, and what it is. */
function spill(cell: Element): string | undefined {
  const box = cell.getBoundingClientRect();
  let worst: { by: number; where: string; what: string } | undefined;
  const note = (r: DOMRect, what: string): void => {
    if (r.width === 0 && r.height === 0) return;
    const below = r.bottom - box.bottom;
    const beside = Math.max(r.right - box.right, box.left - r.left);
    const by = Math.max(below, beside);
    if (by > 0.5 && (worst === undefined || by > worst.by))
      worst = { by, where: below >= beside ? 'below' : 'beside', what: what.replace(/\s+/g, ' ').trim().slice(0, 60) };
  };
  for (const el of cell.querySelectorAll('*')) {
    if (el.closest('[hidden], .sr-only') !== null) continue;
    // a box that clips must not be cutting off what's in it from below (a line an ellipsis ends is fine: that's across)
    const s = getComputedStyle(el);
    if (s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2) {
      const r = el.getBoundingClientRect();
      note(
        new DOMRect(r.left, r.top, r.width, r.height + el.scrollHeight - el.clientHeight),
        `cut off inside: ${el.textContent}`,
      );
    }
    // what a box clips (a progress bar's fill, shifted along its track) shows only within that box
    if (clipped(el, cell)) continue;
    note(el.getBoundingClientRect(), el.textContent);
  }
  // text that runs on past its own element's box (a long name with nowhere to wrap)
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    if (t.textContent?.trim() === '' || t.parentElement?.closest('[hidden], .sr-only') !== null || clipped(t, cell)) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    note(range.getBoundingClientRect(), t.textContent ?? '');
  }
  return worst === undefined ? undefined : `${String(Math.round(worst.by))}px ${worst.where}: “${worst.what}”`;
}

/** Hidden from sight but kept for screen readers (Tailwind's sr-only, under whatever variant put it there). */
function unseen(el: Element, within: Element): boolean {
  for (let e: Element | null = el; e !== null && e !== within.parentElement; e = e.parentElement) {
    if (getComputedStyle(e).overflowX === 'hidden' && e.getBoundingClientRect().width <= 1) return true;
  }
  return false;
}

/**
 * What a narrow widget's heading may have cost it, if anything: a link in
 * the widget's body left as an arrow without its words (only the heading's
 * link is short), or the "?" pushed away from the title it's about.
 */
function amiss(cell: Element): string | undefined {
  for (const a of cell.querySelectorAll('[data-fit-box] a[href]')) {
    if (a.closest('[hidden]') !== null) continue;
    const words = [...a.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() !== '');
    if (words.length > 0 && words.every((w) => unseen(w, a))) return `a link without its words: “${a.textContent.trim()}”`;
  }
  const title = cell.querySelector('[data-slot="card-title"]')?.getBoundingClientRect();
  const ask = cell.querySelector('button[aria-label^="About "]')?.getBoundingClientRect();
  if (title !== undefined && ask !== undefined && ask.top < title.bottom && ask.bottom > title.top) {
    const gap = Math.round(ask.left - title.right);
    if (gap > 20) return `the “?” ${String(gap)}px from its title`;
  }
  return undefined;
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** Home being edited: each widget's bar lies over its foot, and must fit there too. */
const EDITING: Editing = { move: () => undefined, resize: () => undefined, remove: () => undefined, announce: () => undefined };

async function drawn(scenario: Scenario, width: string, editing?: Editing): Promise<Element[]> {
  router.scenario = scenario;
  const data: HomeData = { d: dashboard(scenario), live: live(scenario), ap: scenario === 'ap' };
  // being edited, every widget shows (one with nothing to show says so)
  const shown = editing === undefined ? LAYOUT.filter((w) => definition(w.id).hidden?.(data) !== true) : LAYOUT;
  const screen = await renderWithProviders(
    // as the app has it around every page (app.tsx)
    <TooltipProvider>
      <div style={{ width }}>
        <HomeGrid layout={LAYOUT} data={data} editing={editing} />
      </div>
    </TooltipProvider>,
  );
  const grid = screen.container.querySelector('[class*="@container/home"] > div');
  if (grid === null) throw new Error('no grid');
  // the widgets that read the router themselves have their answers, and what doesn't fit has gone
  await vi.waitFor(() => {
    expect(grid.textContent).not.toMatch(/Reading the|Loading…/);
  });
  await frame();
  await frame();
  const cells = [...grid.children];
  expect(cells.length).toBe(shown.length);
  return cells;
}

// (the theme each test chooses is kept in localStorage, which the test files run after this one in the same
// browser read as theirs: the default goes back after the last, as its explanations show inline)
afterAll(() => setThemeId(DEFAULT_THEME_ID));

describe.each(pickableThemes().map((t) => ({ name: t.name, id: t.id })))('$name', ({ id }) => {
  test.each(SCENARIOS.flatMap((scenario) => WIDTHS.map((w) => ({ scenario, ...w }))))(
    'the $scenario router at $name: every widget within its cell',
    async ({ scenario, width }) => {
      await setThemeId(id);
      const data: HomeData = { d: dashboard(scenario), live: live(scenario), ap: scenario === 'ap' };
      const shown = LAYOUT.filter((w) => definition(w.id).hidden?.(data) !== true);
      const cells = await drawn(scenario, width);
      const spills = cells.flatMap((cell, i) => {
        const w = shown[i];
        const s = spill(cell) ?? amiss(cell);
        return w === undefined || s === undefined ? [] : [`${w.id} ${sizeLabel(w.size)}: ${s}`];
      });
      expect(spills).toEqual([]);
      await cleanup();
    },
  );

  test.each(WIDTHS.slice(0, 2))('being edited at $name: every widget and its bar within its cell', async ({ width }) => {
    await setThemeId(id);
    const cells = await drawn('busy', width, EDITING);
    const spills = cells.flatMap((cell, i) => {
      const w = LAYOUT[i];
      const s = spill(cell);
      return w === undefined || s === undefined ? [] : [`${w.id} ${sizeLabel(w.size)}: ${s}`];
    });
    expect(spills).toEqual([]);
    await cleanup();
  });
});

// the pretend router answers what Home's widgets ask, so a widget showing "didn't load" is a test that's wrong
test('the pretend router answers every widget on the busy router', async () => {
  const cells = await drawn('busy', '56rem');
  const text = cells.map((c) => c.textContent).join('\n');
  expect(text).not.toMatch(/didn’t load|didn't load|didn’t say/);
  // an escape written where JSX takes it as text shows as it's written
  expect(text).not.toMatch(/\\u[0-9a-f]{4}|&[a-z]+;/i);
  expect(answer('busy', 'nothing', 'here', {})).toBeUndefined();
  await cleanup();
});
