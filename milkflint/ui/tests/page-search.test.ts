import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groups } from '@/features/groups';
import { featureIds } from '@/features/ids';
import { searchPages } from '@/features/search';
import { sections } from '@/features/sections';
import type { Feature, GroupId } from '@/features/types';
import { href, tabFrom, tabHref } from '@/lib/router';

// Pages as the search sees them, without loading any page's code.
const fake = (id: (typeof featureIds)[number], title: string, group?: GroupId): Feature =>
  ({ id, title, description: '', order: 0, ...(group !== undefined ? { group } : {}) }) as unknown as Feature;
const titles: Partial<Record<(typeof featureIds)[number], [string, GroupId]>> = {
  sqm: ['Smart Queue', 'speed'],
  wifi: ['Networks & radios', 'wifi'],
  'wifi-guest': ['Guest Wi-Fi', 'wifi'],
  'wifi-scan': ['Nearby networks', 'wifi'],
  firewall: ['Firewall', 'security'],
  banip: ['banIP', 'security'],
  logs: ['Logs', 'system'],
  tuning: ['Performance tuning', 'advanced'],
  'admin-password': ['Router access', 'system'],
};
// as the menu gives them: without the pages folded into another (inMenu: false)
const pages = featureIds
  .filter((id) => id !== 'https' && id !== 'radar-scan')
  .map((id) => {
    const t = titles[id];
    return t === undefined ? fake(id, id) : fake(id, t[0], t[1]);
  });
const groupOf = (f: Feature): (typeof groups)[number] | undefined => groups.find((g) => g.id === f.group);
const search = (q: string, from: readonly Feature[] = pages): string[] => searchPages(q, from, groupOf).map((m) => m.href);
const first = (q: string): string | undefined => search(q)[0];

test('page search: by title, by group, and by another word for what a page does', () => {
  assert.equal(first('smart'), '#/sqm');
  assert.equal(first('qos'), '#/sqm');
  assert.equal(first('ssid'), '#/wifi');
  assert.equal(first('port forward'), '#/port-forwards');
  assert.equal(first('nat'), '#/firewall');
  assert.ok(search('speed').includes('#/sqm'), 'a page is found by its group');
  assert.deepEqual(searchPages('   ', pages, groupOf), []);
  assert.deepEqual(searchPages('zzzz', pages, groupOf), []);
  assert.ok(searchPages('a', pages, groupOf).length <= 8);
});

test('a tab or card is found by its name or another word for it, and opens it', () => {
  // the radar scan (a tab of Nearby networks) and the radar log, ahead of the page with "radar" in its words
  const radar = search('radar');
  assert.deepEqual(radar.slice(0, 2), ['#/logs/radar', '#/wifi-scan/radar']);
  assert.ok(radar.includes('#/wifi-scan'), 'the page itself is still there');
  assert.equal(first('radar log'), '#/logs/radar');
  assert.equal(first('radar scan'), '#/wifi-scan/radar');
  assert.equal(first('dmesg'), '#/logs/kernel');
  assert.equal(first('crash'), '#/logs/crash');
  assert.equal(first('zones'), '#/firewall/zones');
  assert.equal(first('your lists'), '#/banip/lists');
  assert.equal(first('https'), '#/admin-password/https');
  assert.equal(first('diagnostics'), '#/tuning/diagnostics');
  const hit = searchPages('radar log', pages, groupOf)[0];
  assert.equal(hit?.section?.title, 'Radar log');
  assert.equal(hit.feature.title, 'Logs', 'a section says whose it is');
  assert.equal(searchPages('logs', pages, groupOf)[0]?.section, undefined, 'a page is its own result');
});

test("a page's name alone lists the page, not its every tab", () => {
  const logs = search('logs');
  assert.equal(logs[0], '#/logs');
  assert.ok(!logs.some((h) => h.startsWith('#/logs/')), logs.join(' '));
  // but a word of the tab's own does
  assert.equal(search('logs kernel')[0], '#/logs/kernel');
});

test('Wi-Fi is found as wifi and as wi-fi', () => {
  for (const q of ['wifi', 'wi-fi', 'WiFi']) {
    const hits = search(q);
    assert.ok(hits.includes('#/wifi-guest'), `${q}: Guest Wi-Fi`);
    assert.ok(hits.includes('#/wifi'), `${q}: the Wi-Fi group's pages`);
  }
  assert.equal(first('guest wifi'), '#/wifi-guest');
  assert.equal(first('wifi log'), '#/logs/wifi');
});

test('only the parts of pages the menu has (access point mode leaves some out)', () => {
  const noFirewall = pages.filter((p) => p.id !== 'firewall');
  assert.ok(!search('zones', noFirewall).includes('#/firewall/zones'));
  assert.ok(searchPages('radar', noFirewall, groupOf, 8, []).every((m) => m.section === undefined));
});

test('every section is on a page there is, once, with an address that opens it', () => {
  const seen = new Set<string>();
  for (const s of sections) {
    assert.ok((featureIds as readonly string[]).includes(s.page), s.page);
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(s.title !== '' && s.keywords === s.keywords.toLowerCase(), s.title);
    const where = href(s.page, s.id);
    assert.ok(!seen.has(where), where);
    seen.add(where);
  }
});

test('tab addresses: #/<page>/<tab>, the page’s own for its first tab', () => {
  const tabs = [{ id: 'system' }, { id: 'radar' }] as const;
  assert.equal(tabFrom('radar', tabs, 'system'), 'radar');
  assert.equal(tabFrom('', tabs, 'system'), 'system');
  assert.equal(tabFrom('nothing', tabs, 'system'), 'system');
  assert.equal(tabFrom('radar/more', tabs, 'system'), 'radar');
  assert.equal(tabHref('logs', 'system', 'system'), '#/logs');
  assert.equal(tabHref('logs', 'radar', 'system'), '#/logs/radar');
  assert.equal(href('logs'), '#/logs');
  assert.equal(href('logs', ''), '#/logs');
});

test('the real menu: radar opens the radar scan and the radar log, wifi finds the Wi-Fi pages', async () => {
  // the menu's pages load no page code until one is drawn
  const { groupOf: realGroupOf, menuFor } = await import('@/features/index');
  for (const mode of ['router', 'ap'] as const) {
    const menuPages = menuFor(mode).flatMap((e): Feature[] => (e.kind === 'page' ? [e.feature] : [...e.group.features]));
    const hits = (q: string): string[] => searchPages(q, menuPages, realGroupOf).map((m) => m.href);
    assert.deepEqual(hits('radar').slice(0, 2), ['#/logs/radar', '#/wifi-scan/radar'], mode);
    assert.ok(hits('wifi').includes('#/wifi'), mode);
    assert.ok(hits('wifi').includes('#/wifi-driver'), mode);
    // Guest Wi-Fi, the firewall and banIP are the main router's
    assert.equal(hits('wifi').includes('#/wifi-guest'), mode === 'router', mode);
    assert.equal(hits('zones').includes('#/firewall/zones'), mode === 'router', mode);
    assert.equal(hits('your lists').includes('#/banip/lists'), mode === 'router', mode);
  }
  // every section's page is in the router's menu, so none is left out of the search by accident
  const routerPages = menuFor('router').flatMap((e): Feature[] => (e.kind === 'page' ? [e.feature] : [...e.group.features]));
  for (const s of sections)
    assert.ok(
      routerPages.some((p) => p.id === s.page),
      `${s.page} is in the menu`,
    );
});
