// The VPN page (Send through a VPN) in a real browser, against the pretend
// router's busy household with a WireGuard client added to its network
// config: the page draws "Who uses it", "Protection and speed" and the
// provider's server, a changed choice offers Save, and Save stages the
// change as a uci call. Then its profiles ("USA", "France"): listed with the
// active one badged, Activate behind a worded confirm, Edit in a sheet that
// writes only the profile, Rename, Delete, New, "Save these settings as a
// profile", the guard while the page has unsaved changes, a profile changed
// outside the page, and a switch whose server doesn't answer. And its sites
// that go direct: offered only where dnsmasq can fill the sets, cleaned as
// typed, kept in dhcp's list, with what's wrong and the notes in the
// field's description, and a site taken off only saved (the router flushes
// the sets itself), and Remove saying the list goes too.
import 'virtual:milkflint-themes.css';
import '@/styles.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { loadClient } from '@/features/vpn-client/api';
import { VpnClientPage } from '@/features/vpn-client/page';
import { formOf, profileToSection } from '@/features/vpn-client/profiles';
import type * as Ubus from '@/lib/ubus';
import { renderWithProviders } from './render';

interface Sent {
  object: string;
  method: string;
  params: Record<string, unknown>;
}
const sent = vi.hoisted(() => [] as Sent[]);

/** What the pretend router holds beyond the busy household: the tunnel, the profiles, and its clock after a save. */
const fx = vi.hoisted(() => ({
  tunnel: true,
  profiles: [] as { id: string; options: Record<string, string | string[]> }[],
  active: undefined as string | undefined,
  /** seconds added to the router's clock (milkflint.vpn status) */
  skew: 0,
  /** the skew from the next uci apply on: time passing after a switch */
  skewOnApply: 0,
  /** the tunnel's interface is switched off */
  off: false,
  /** the next uci apply fails */
  failApply: false,
  /** the router's dnsmasq can fill nftables sets (milkflint.vpn status) */
  nftset: false,
  /** dhcp.wg_out_direct's names, as LuCI could have left them */
  direct: [] as string[],
  /** while set, the config reads wait for it: a slow reload */
  gate: undefined as Promise<void> | undefined,
  /** the writes the router has applied, replayed over what it answers */
  applied: [] as Sent[],
  pending: [] as Sent[],
}));

/** The config as the writes applied so far leave it (set, add, delete of a section or of options). */
function replay(raw: unknown, config: string): unknown {
  const values = (raw as { values: Record<string, Record<string, unknown>> }).values;
  for (const c of fx.applied) {
    if (c.params['config'] !== config) continue;
    const section = c.params['section'];
    const given = (c.params['values'] ?? {}) as Record<string, unknown>;
    if (c.method === 'add' && typeof c.params['name'] === 'string') {
      const old = values[c.params['name']];
      values[c.params['name']] = {
        '.anonymous': false,
        '.type': c.params['type'],
        '.name': c.params['name'],
        '.index': old?.['.index'] ?? Object.keys(values).length,
        ...old,
        ...given,
      };
    } else if (c.method === 'set' && typeof section === 'string' && values[section] !== undefined) {
      Object.assign(values[section], given);
    } else if (c.method === 'delete' && typeof section === 'string') {
      const options = c.params['options'];
      if (Array.isArray(options)) for (const o of options) Reflect.deleteProperty(values[section] ?? {}, String(o));
      else Reflect.deleteProperty(values, section);
    }
  }
  return raw;
}

/** The busy router's network config with the VPN client in it. */
function withClient(raw: unknown): unknown {
  const values = (raw as { values: Record<string, unknown> }).values;
  const add = (name: string, type: string, options: Record<string, unknown>): void => {
    values[name] = { '.anonymous': false, '.type': type, '.name': name, '.index': Object.keys(values).length, ...options };
  };
  add('wg_out', 'interface', {
    proto: 'wireguard',
    ...(fx.off ? { disabled: '1' } : {}),
    private_key: 'aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8c=',
    addresses: ['10.64.12.7/32'],
  });
  add('wg_out_server', 'wireguard_wg_out', {
    public_key: 'pIa0uK1vPn2sErVeR3kEy4fOr5tEsTs6aBcDeFgHiJk=',
    endpoint_host: '198.51.100.10',
    endpoint_port: '1337',
    persistent_keepalive: '25',
    route_allowed_ips: '1',
    allowed_ips: ['0.0.0.0/0', '::/0'],
  });
  return raw;
}

/** The dhcp config with the sites that go direct, when there are any. */
function withDirect(raw: unknown): unknown {
  const values = (raw as { values: Record<string, unknown> }).values;
  if (fx.direct.length > 0)
    values['wg_out_direct'] = {
      '.anonymous': false,
      '.type': 'ipset',
      '.name': 'wg_out_direct',
      '.index': Object.keys(values).length,
      name: ['wg_out_direct4', 'wg_out_direct6'],
      domain: fx.direct,
      table: 'fw4',
      table_family: 'inet',
    };
  return raw;
}

/** The milkflint config with the profiles and the pointer to the active one. */
function withProfiles(raw: unknown): unknown {
  const values = (raw as { values: Record<string, unknown> }).values;
  const add = (name: string, type: string, options: Record<string, unknown>): void => {
    values[name] = { '.anonymous': false, '.type': type, '.name': name, '.index': Object.keys(values).length, ...options };
  };
  for (const p of fx.profiles) add(p.id, 'vpn_profile', p.options);
  if (fx.active !== undefined) add('vpn_profiles', 'vpn_profiles', { active: fx.active });
  return raw;
}

vi.mock('@/lib/ubus', async (importOriginal) => {
  const real = await importOriginal<typeof Ubus>();
  return {
    ...real,
    call: async (object: string, method: string, params: Record<string, unknown>, schema: { parse: (v: unknown) => unknown }) => {
      const { answer } = await import('./router');
      if (object === 'uci' && method === 'get' && fx.gate !== undefined) await fx.gate;
      let raw = answer('busy', object, method, params);
      if (object === 'uci' && method === 'get' && params['config'] === 'network' && fx.tunnel) raw = withClient(raw);
      if (object === 'uci' && method === 'get' && params['config'] === 'milkflint') raw = withProfiles(raw);
      if (object === 'uci' && method === 'get' && params['config'] === 'dhcp') raw = withDirect(raw);
      if (
        object === 'uci' &&
        method === 'get' &&
        ['network', 'firewall', 'sqm', 'milkflint', 'dhcp'].includes(String(params['config']))
      )
        raw = raw === undefined ? raw : replay(raw, String(params['config']));
      if (object === 'uci' && method === 'changes') raw = { changes: {} };
      if (object === 'milkflint.vpn' && method === 'status')
        raw = { ...(raw as object), now: (raw as { now: number }).now + fx.skew, ...(fx.nftset ? { nftset: true } : {}) };
      if (raw === undefined) throw new real.UbusError(object, method, real.UbusStatus.methodNotFound);
      return schema.parse(raw);
    },
    exec: (object: string, method: string, given?: Record<string, unknown>) => {
      const params = given ?? {};
      sent.push({ object, method, params });
      // the pointer, kept as the router would
      const values = params['values'] as Record<string, unknown> | undefined;
      const pointer =
        object === 'uci' &&
        params['config'] === 'milkflint' &&
        ((method === 'set' && params['section'] === 'vpn_profiles') || (method === 'add' && params['type'] === 'vpn_profiles'));
      if (pointer && typeof values?.['active'] === 'string') fx.active = values['active'];
      if (object === 'uci' && method === 'revert') fx.pending = fx.pending.filter((c) => c.params['config'] !== params['config']);
      if (object === 'uci' && ['set', 'add', 'delete'].includes(method)) fx.pending.push({ object, method, params });
      if (object === 'uci' && method === 'apply') {
        if (fx.failApply) return Promise.reject(new Error('apply failed'));
        fx.skew = fx.skewOnApply;
        fx.applied.push(...fx.pending);
        fx.pending = [];
      }
      return Promise.resolve();
    },
  };
});

beforeEach(() => {
  sent.length = 0;
  fx.tunnel = true;
  fx.profiles = [];
  fx.active = undefined;
  fx.skew = 0;
  fx.skewOnApply = 0;
  fx.off = false;
  fx.failApply = false;
  fx.nftset = false;
  fx.direct = [];
  fx.gate = undefined;
  fx.applied = [];
  fx.pending = [];
});

afterEach(async () => {
  await cleanup();
  await page.viewport(1400, 1000);
});

async function drawPage(): Promise<Awaited<ReturnType<typeof renderWithProviders>>> {
  window.location.hash = '#/vpn-client';
  const screen = await renderWithProviders(
    <TooltipProvider>
      <VpnClientPage />
    </TooltipProvider>,
  );
  await expect.element(screen.getByText('Who uses it')).toBeVisible();
  return screen;
}

const applies = (): Sent[] => sent.filter((c) => c.object === 'uci' && c.method === 'apply');
const staged = (): Sent[] =>
  sent.filter((c) => c.object === 'uci' && (c.method === 'set' || c.method === 'add' || c.method === 'delete'));
const values = (c: Sent): Record<string, unknown> => (c.params['values'] ?? {}) as Record<string, unknown>;
const pointerTo = (id: string): boolean =>
  staged().some(
    (c) =>
      c.params['config'] === 'milkflint' &&
      (c.params['section'] === 'vpn_profiles' || c.params['type'] === 'vpn_profiles') &&
      values(c)['active'] === id,
  );

const FRANCE = {
  name: 'France',
  private_key: `${'p'.repeat(42)}E=`,
  addresses: ['10.70.1.2/32'],
  public_key: `${'F'.repeat(42)}A=`,
  endpoint_host: 'fr.example.com',
  endpoint_port: '51820',
  keepalive: '25',
  who: 'all',
  kill_switch: '1',
  use_vpn_dns: '1',
  dns: ['10.70.0.1'],
  shaper: '0',
};

/** USA holds what runs now (unless `usa` changes it) and is active; France is the other. */
async function twoProfiles(usa: Record<string, string> = {}): Promise<void> {
  const live = await loadClient();
  fx.profiles = [
    { id: 'vpnp_1', options: { ...profileToSection('USA', formOf(live.form)), ...usa } },
    { id: 'vpnp_2', options: FRANCE },
  ];
  fx.active = 'vpnp_1';
}

test('it draws who uses it, protection and speed, and the provider’s server', async () => {
  const screen = await drawPage();
  await expect.element(screen.getByText('Protection and speed')).toBeVisible();
  await expect.element(screen.getByText('The provider’s server')).toBeVisible();
  await expect.element(screen.getByText('What this sets up')).toBeVisible();
  await expect.element(screen.getByRole('switch', { name: 'VPN on' })).toBeVisible();
});

test('changing who uses it offers Save, and Save stages the change', async () => {
  const screen = await drawPage();
  await expect.element(screen.getByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  await screen.getByText('Every home device').click();
  const save = screen.getByRole('button', { name: 'Save & apply' });
  await expect.element(save).toBeVisible();
  await save.click();
  await vi.waitFor(() => {
    expect(applies().length).toBeGreaterThan(0);
  });
  expect(staged().length).toBeGreaterThan(0);
});

test('the profiles are listed, the active one badged, each with its summary', async () => {
  await twoProfiles();
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  const usa = card.getByRole('listitem', { name: 'USA' });
  const france = card.getByRole('listitem', { name: 'France' });
  await expect.element(usa.getByText('Active', { exact: true })).toBeVisible();
  expect(france.getByText('Active', { exact: true }).query()).toBeNull();
  await expect.element(france.getByText('fr.example.com:51820 · Every home device · Kill switch on')).toBeVisible();
  await expect.element(france.getByRole('button', { name: 'Activate France' })).toBeEnabled();
});

test('Activate asks first, in words, and then switches in one apply with the pointer', async () => {
  await twoProfiles();
  const screen = await drawPage();
  await screen.getByRole('region', { name: 'Profiles' }).getByRole('button', { name: 'Activate France' }).click();
  const dialog = screen.getByRole('dialog', { name: 'Switch the VPN to France?' });
  await expect.element(dialog.getByText('fr.example.com:51820', { exact: true })).toBeVisible();
  await expect.element(dialog.getByText('Now: 198.51.100.10:1337')).toBeVisible();
  await expect.element(dialog.getByText('Every home device', { exact: true })).toBeVisible();
  expect(applies()).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Activate', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(pointerTo('vpnp_2')).toBe(true);
  expect(staged().some((c) => c.params['config'] === 'network' && values(c)['endpoint_host'] === 'fr.example.com')).toBe(true);
  await expect.element(screen.getByText('Saved and applied')).toBeVisible();
});

test('Edit opens a sheet that says when it takes effect, and saves only the profile', async () => {
  await twoProfiles();
  const screen = await drawPage();
  await screen.getByRole('region', { name: 'Profiles' }).getByRole('button', { name: 'Edit France' }).click();
  const sheet = screen.getByRole('dialog', { name: 'Edit France' });
  await expect.element(sheet.getByText('Changes here take effect when you activate France.')).toBeVisible();
  await sheet.getByRole('switch', { name: 'Kill switch' }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged().length).toBeGreaterThan(0);
  for (const c of staged()) {
    expect(c.params['config']).toBe('milkflint');
    expect(String(c.params['section'])).toBe('vpnp_2');
  }
  expect(staged().some((c) => values(c)['kill_switch'] === '0')).toBe(true);
});

test('Rename checks the name: another profile’s, in any case, is refused', async () => {
  await twoProfiles();
  const screen = await drawPage();
  await screen.getByRole('region', { name: 'Profiles' }).getByRole('button', { name: 'Rename France' }).click();
  const dialog = screen.getByRole('dialog', { name: 'Rename France' });
  const name = dialog.getByLabelText('Name');
  await name.fill('usa');
  await expect.element(dialog.getByText('Another profile already has this name.')).toBeVisible();
  await expect.element(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await name.fill('Spain');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged()).toEqual([
    { object: 'uci', method: 'set', params: { config: 'milkflint', section: 'vpnp_2', values: { name: 'Spain' } } },
  ]);
});

test('the active profile has no Delete, and says how to delete it; another’s Delete asks first', async () => {
  await twoProfiles();
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  const usa = card.getByRole('listitem', { name: 'USA' });
  await expect.element(usa.getByText('Activate another profile, or remove the VPN, to delete this one.')).toBeVisible();
  expect(usa.getByRole('button', { name: /Delete/ }).query()).toBeNull();
  await card.getByRole('button', { name: 'Delete France' }).click();
  const dialog = screen.getByRole('dialog', { name: 'Delete France?' });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged()).toEqual([{ object: 'uci', method: 'delete', params: { config: 'milkflint', section: 'vpnp_2' } }]);
});

test('New makes a profile from the settings running now, or a blank one, without activating it', async () => {
  await twoProfiles();
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });

  await card.getByRole('button', { name: 'New profile' }).click();
  let dialog = screen.getByRole('dialog', { name: 'New profile' });
  await expect.element(dialog.getByRole('radio', { name: 'The settings running now' })).toBeChecked();
  await dialog.getByLabelText('Name').fill('Spain');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged()).toHaveLength(1);
  const copy = staged()[0];
  expect(copy?.params).toMatchObject({ config: 'milkflint', type: 'vpn_profile', name: 'vpnp_3' });
  expect(copy === undefined ? {} : values(copy)).toMatchObject({ name: 'Spain', endpoint_host: '198.51.100.10' });

  sent.length = 0;
  await card.getByRole('button', { name: 'New profile' }).click();
  dialog = screen.getByRole('dialog', { name: 'New profile' });
  await dialog.getByRole('radio', { name: 'A blank profile' }).click();
  await dialog.getByLabelText('Name').fill('Italy');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged()).toHaveLength(1);
  const blank = staged()[0];
  expect(blank === undefined ? {} : values(blank)).toMatchObject({ name: 'Italy' });
  expect(blank === undefined ? {} : values(blank)).not.toHaveProperty('endpoint_host');
  expect(pointerTo('vpnp_3')).toBe(false);
});

test('“Save these settings as a profile” saves the page and makes the new profile the active one', async () => {
  const screen = await drawPage();
  await screen.getByRole('radio', { name: 'Every home device' }).click();
  await screen
    .getByRole('region', { name: 'Unsaved changes' })
    .getByRole('button', { name: 'Save these settings as a profile' })
    .click();
  const dialog = screen.getByRole('dialog', { name: 'Save these settings as a profile' });
  await dialog.getByLabelText('Name').fill('Home');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  const made = staged().find((c) => c.params['type'] === 'vpn_profile');
  expect(made?.params).toMatchObject({ config: 'milkflint', name: 'vpnp_1' });
  expect(made === undefined ? {} : values(made)).toMatchObject({ name: 'Home', who: 'all' });
  expect(pointerTo('vpnp_1')).toBe(true);
  // and the page's own save, in the same apply
  expect(staged().some((c) => c.params['config'] === 'firewall')).toBe(true);
});

test('while the page has unsaved changes, Activate, Delete and New wait, and say why', async () => {
  await twoProfiles();
  const screen = await drawPage();
  await screen.getByRole('radio', { name: 'Every home device' }).click();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await expect.element(card.getByText('Save or discard your changes on this page first.')).toBeVisible();
  await expect.element(card.getByRole('button', { name: 'Activate France' })).toBeDisabled();
  await expect.element(card.getByRole('button', { name: 'Delete France' })).toBeDisabled();
  await expect.element(card.getByRole('button', { name: 'New profile' })).toBeDisabled();
  await expect.element(card.getByRole('button', { name: 'Edit France' })).toBeEnabled();
  // Rename doesn't touch what runs, so it works, and the page's changes stay
  await card.getByRole('button', { name: 'Rename France' }).click();
  const dialog = screen.getByRole('dialog', { name: 'Rename France' });
  await dialog.getByLabelText('Name').fill('Spain');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect.element(screen.getByText('Saved and applied')).toBeVisible();
  await expect.element(screen.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
});

test('with no profiles, the card waits for the tunnel', async () => {
  fx.tunnel = false;
  const before = await drawPage();
  expect(before.getByRole('region', { name: 'Profiles' }).query()).toBeNull();
  await cleanup();
  fx.tunnel = true;
  const after = await drawPage();
  const card = after.getByRole('region', { name: 'Profiles' });
  await expect.element(card).toBeVisible();
  await expect.element(card.getByRole('button', { name: 'Save these settings as a profile' })).toBeVisible();
});

test('an active profile changed outside the page says so, and Save to puts the running settings in it', async () => {
  await twoProfiles({ endpoint_host: 'us.example.com' });
  const screen = await drawPage();
  const usa = screen.getByRole('region', { name: 'Profiles' }).getByRole('listitem', { name: 'USA' });
  await expect.element(usa.getByText('Changed outside this page')).toBeVisible();
  await usa.getByRole('button', { name: 'Save to USA' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged()).toEqual([
    {
      object: 'uci',
      method: 'set',
      params: { config: 'milkflint', section: 'vpnp_1', values: { endpoint_host: '198.51.100.10' } },
    },
  ]);
});

test('a switch whose server doesn’t answer in 30 s says so, and Go back activates the one before', async () => {
  await twoProfiles();
  fx.skewOnApply = 40;
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await card.getByRole('button', { name: 'Activate France' }).click();
  await screen
    .getByRole('dialog', { name: 'Switch the VPN to France?' })
    .getByRole('button', { name: 'Activate', exact: true })
    .click();
  await expect.element(card.getByText('France is set, but its server hasn’t answered yet.')).toBeVisible();
  sent.length = 0;
  await card.getByRole('button', { name: 'Go back to USA' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(pointerTo('vpnp_1')).toBe(true);
});

test('after an Activate the badge has moved and nothing says it changed outside the page', async () => {
  await twoProfiles();
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await card.getByRole('button', { name: 'Activate France' }).click();
  await screen
    .getByRole('dialog', { name: 'Switch the VPN to France?' })
    .getByRole('button', { name: 'Activate', exact: true })
    .click();
  await expect.element(card.getByRole('listitem', { name: 'France' }).getByText('Active', { exact: true })).toBeVisible();
  expect(card.getByRole('listitem', { name: 'USA' }).getByText('Active', { exact: true }).query()).toBeNull();
  await expect.element(card.getByRole('button', { name: 'Activate USA' })).toBeVisible();
  // the Activate that was clicked is gone: focus is on the card, not lost
  await vi.waitFor(() => {
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Profiles');
  });
  expect(screen.getByText('Changed outside this page').query()).toBeNull();
  expect(screen.getByText('Settings changed outside this page').query()).toBeNull();
});

test('the page’s Save writes the active profile in the same apply, and nothing says it changed outside afterwards', async () => {
  await twoProfiles();
  const screen = await drawPage();
  await screen.getByRole('radio', { name: 'Every home device' }).click();
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(staged().some((c) => c.params['config'] === 'milkflint' && c.params['section'] === 'vpnp_1')).toBe(true);
  expect(staged().some((c) => c.params['config'] === 'firewall')).toBe(true);
  await expect.element(screen.getByText('Saved and applied')).toBeVisible();
  expect(screen.getByText('Changed outside this page').query()).toBeNull();
});

test('Go back waits while the page has unsaved changes, and says why', async () => {
  await twoProfiles();
  fx.skewOnApply = 40;
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await card.getByRole('button', { name: 'Activate France' }).click();
  await screen
    .getByRole('dialog', { name: 'Switch the VPN to France?' })
    .getByRole('button', { name: 'Activate', exact: true })
    .click();
  const back = card.getByRole('button', { name: 'Go back to USA' });
  await expect.element(back).toBeEnabled();
  await screen.getByRole('radio', { name: 'No home devices' }).click();
  await expect.element(back).toBeDisabled();
  await expect.element(card.getByText('Save or discard your changes on this page first.')).toBeVisible();
  expect(back.element().getAttribute('aria-describedby')).not.toBeNull();
});

test('New from the settings running now, with no profile active, makes the copy the active one', async () => {
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await expect.element(card.getByRole('listitem', { name: 'The settings running now' })).toBeVisible();
  await card.getByRole('button', { name: 'New profile' }).click();
  const dialog = screen.getByRole('dialog', { name: 'New profile' });
  await dialog.getByLabelText('Name').fill('Home');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(pointerTo('vpnp_1')).toBe(true);
  await expect.element(card.getByRole('listitem', { name: 'Home' }).getByText('Active', { exact: true })).toBeVisible();
});

test('Go back after switching from a VPN that was off turns it off again', async () => {
  fx.off = true;
  await twoProfiles();
  fx.skewOnApply = 40;
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await card.getByRole('button', { name: 'Activate France' }).click();
  await screen
    .getByRole('dialog', { name: 'Switch the VPN to France?' })
    .getByRole('button', { name: 'Activate', exact: true })
    .click();
  await card.getByRole('button', { name: 'Go back to USA' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(2);
  });
  const last = fx.applied.filter((c) => c.params['config'] === 'network' && c.params['section'] === 'wg_out').at(-1);
  expect(last?.params['values']).toMatchObject({ disabled: '1' });
});

test('a blank profile whose save fails doesn’t open its sheet', async () => {
  await twoProfiles();
  fx.failApply = true;
  const screen = await drawPage();
  const card = screen.getByRole('region', { name: 'Profiles' });
  await card.getByRole('button', { name: 'New profile' }).click();
  const dialog = screen.getByRole('dialog', { name: 'New profile' });
  await dialog.getByRole('radio', { name: 'A blank profile' }).click();
  await dialog.getByLabelText('Name').fill('Italy');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.element(screen.getByText('apply failed')).toBeVisible();
  expect(screen.getByRole('dialog', { name: 'Edit Italy' }).query()).toBeNull();
  // and once it saves, the sheet opens
  fx.failApply = false;
  await card.getByRole('button', { name: 'New profile' }).click();
  const again = screen.getByRole('dialog', { name: 'New profile' });
  await again.getByRole('radio', { name: 'A blank profile' }).click();
  await again.getByLabelText('Name').fill('Italy');
  await again.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.element(screen.getByRole('dialog', { name: 'Edit Italy' })).toBeVisible();
});

test('while the page reloads after a Save, its buttons and fields take no new edits', async () => {
  await twoProfiles();
  const screen = await drawPage();
  let release: () => void = () => undefined;
  fx.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await screen.getByText('Every home device').first().click();
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  const activate = screen.getByRole('region', { name: 'Profiles' }).getByRole('button', { name: 'Activate France' });
  await expect.element(activate).toBeDisabled();
  expect(document.querySelector('fieldset[id]')?.hasAttribute('disabled')).toBe(true);
  release();
  await expect.element(activate).toBeEnabled();
  await vi.waitFor(() => {
    expect(document.querySelector('fieldset[id]')?.hasAttribute('disabled')).toBe(false);
  });
});

// ---- sites that go direct ----

const inDhcp = (): Sent[] => staged().filter((c) => c.params['config'] === 'dhcp');

test('without a dnsmasq that fills sets, the sites list says to update MilkFlint, and a save writes nothing to dhcp', async () => {
  const screen = await drawPage();
  await expect
    .element(screen.getByText('This firmware’s DNS can’t do this yet: update MilkFlint to use sites that go direct.'))
    .toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Sites that go direct' }).query()).toBeNull();
  await screen.getByText('Every home device').first().click();
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  expect(inDhcp()).toEqual([]);
});

test('the sites list: cleaned as typed, kept in dhcp’s list, described with what’s wrong and how to type it, and a site taken off only saved', async () => {
  fx.nftset = true;
  const screen = await drawPage();
  // the pretend router's tunnel has no marks yet: someone has to use it
  await screen.getByText('Every home device').first().click();
  const field = screen.getByRole('textbox', { name: 'Sites that go direct' });
  await expect.element(screen.getByText(/One site a line, or commas between them/)).toBeVisible();
  await field.fill('https://www.BBC.co.uk/iplayer\nitv.com\nbad_name!');
  await expect.element(screen.getByText('Not a site’s name, left out: bad_name!')).toBeVisible();
  // the field's description: what's wrong first, then the notes
  const described = (): string[] =>
    (field.element().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? `(no ${id})`);
  expect(described()[0]).toBe('Not a site’s name, left out: bad_name!');
  expect(described().slice(1).join(' ')).toMatch(/One site a line, or commas between them\. Each covers everything under it/);
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(1);
  });
  const list = inDhcp().find((c) => c.method === 'add' && c.params['name'] === 'wg_out_direct');
  expect(values(list ?? { object: '', method: '', params: {} })['domain']).toEqual(['www.bbc.co.uk', 'itv.com']);
  expect(staged().some((c) => c.params['config'] === 'firewall' && c.params['name'] === 'wg_out_direct_lan_4')).toBe(true);
  await expect.element(screen.getByText('Saved and applied')).toBeVisible();
  // read back as kept, with nothing wrong to say
  await expect.element(field).toHaveValue('www.bbc.co.uk\nitv.com');
  expect(described()).toHaveLength(1);
  await field.fill('www.bbc.co.uk');
  await screen.getByRole('button', { name: 'Save & apply' }).click();
  await vi.waitFor(() => {
    expect(applies()).toHaveLength(2);
  });
  const kept = inDhcp().filter((c) => c.method === 'set' && c.params['section'] === 'wg_out_direct');
  expect(kept.map((c) => values(c)['domain'])).toContainEqual(['www.bbc.co.uk']);
  // the router flushes the sets itself, however the list changed: the page only saves
  await expect.element(screen.getByText('Saved and applied')).toBeVisible();
  expect(sent.filter((c) => c.object === 'milkflint.vpn' && c.method !== 'status')).toEqual([]);
  // and Remove says the list goes with the rest
  await screen.getByRole('button', { name: 'Remove the VPN' }).click();
  await expect.element(screen.getByText(/The list of sites that go direct goes too\./)).toBeVisible();
});

test('a site LuCI added to dhcp’s list is part of the list here', async () => {
  fx.nftset = true;
  fx.direct = ['bbc.co.uk', 'itv.com'];
  const screen = await drawPage();
  await expect.element(screen.getByRole('textbox', { name: 'Sites that go direct' })).toHaveValue('bbc.co.uk\nitv.com');
});
