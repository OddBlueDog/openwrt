// The two Wi-Fi pages share one form per band: Networks & radios writes the
// band's network and radio, the Wi-Fi driver page its driver settings, and
// neither writes the other's. Before a save, each says which band's devices
// will drop (and this browser's device with them, if it's on that band).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { airtimeBandDefaults } from '../src/features/wifi/airtime.ts';
import { MURU_DEFAULTS } from '../src/features/wifi/muru.ts';
import {
  driverChanged,
  driverChanges,
  driverImpacts,
  driverSection,
  impactLines,
  networkChanged,
  networkChanges,
  networkImpacts,
  type RadioForm,
  radarNote,
  validateDriver,
  validateNetwork,
} from '../src/features/wifi/model.ts';
import { twtOf } from '../src/features/wifi/twt.ts';
import type { Change } from '../src/lib/api/uci.ts';

function band(radio: string, b: string, more: Partial<RadioForm> = {}): RadioForm {
  return {
    radio,
    band: b,
    enabled: true,
    channel: b === '2g' ? 'auto' : '36',
    modePrefix: 'HE',
    width: b === '2g' ? '20' : '80',
    requireMode: '',
    txpower: '',
    allowDfs: true,
    iface: `default_${radio}`,
    ssid: 'home',
    encryption: 'sae-mixed',
    cipher: '',
    key: 'correct horse',
    hidden: false,
    randomBssid: false,
    beamforming: true,
    muMimo: true,
    spr: { mode: 'auto', threshold: -72 },
    qosMap: '',
    twt: twtOf(undefined, () => undefined),
    holdBack: 'short',
    airtime: true,
    airtimeBands: { ...airtimeBandDefaults(b), auto: 'balanced' },
    multicastToUnicast: false,
    muru: { ...MURU_DEFAULTS },
    ...more,
  };
}

const two = (): RadioForm[] => [band('radio0', '2g'), band('radio1', '5g')];
/** 5 GHz's radar channels and how long each one's check takes */
const options = { radio0: { dfs: [], cacMs: {} }, radio1: { dfs: [5260, 5280, 5300, 5320], cacMs: {} } };

/** Every option a list of changes sets or unsets, as section.option */
function touched(changes: readonly Change[]): string[] {
  return changes.flatMap((c) =>
    c.op === 'set'
      ? Object.keys(c.values).map((o) => `${c.section}.${o}`)
      : c.op === 'unset'
        ? c.options.map((o) => `${c.section}.${o}`)
        : [],
  );
}

const DRIVER_OPTIONS = /he_spr_|he_mu_edca_|he_twt_responder|multicast_to_unicast|qos_map_set/;

test('a network save writes the band’s network and radio, never a driver option', () => {
  const [before] = two();
  assert.ok(before !== undefined);
  const after = {
    ...before,
    ssid: 'new',
    key: 'another password',
    channel: '6',
    hidden: true,
    randomBssid: true,
    beamforming: false,
    muMimo: false,
  };
  const options = touched(networkChanges(after, before));
  assert.ok(options.includes('radio0.channel'));
  assert.ok(options.includes('default_radio0.ssid'));
  assert.ok(options.includes('default_radio0.key'));
  assert.ok(options.includes('default_radio0.macaddr'));
  assert.ok(options.includes('radio0.mu_beamformee'));
  assert.deepEqual(
    options.filter((o) => DRIVER_OPTIONS.test(o)),
    [],
  );
});

test('a driver save writes only what changed of the driver’s options', () => {
  const [, before] = two();
  assert.ok(before !== undefined);
  const after: RadioForm = {
    ...before,
    spr: { mode: 'devices', threshold: -67 },
    holdBack: 'openwrt',
    twt: { ...before.twt, on: false },
    multicastToUnicast: true,
    qosMap: '0,0,2,16,1,1,255,255,18,22,24,38,40,40,44,46,48,56',
  };
  const options = touched(driverChanges(after, before));
  assert.deepEqual(options.sort(), [
    'default_radio1.multicast_to_unicast',
    'default_radio1.qos_map_set',
    'radio1.he_mu_edca_ac_be_timer',
    'radio1.he_mu_edca_ac_bk_timer',
    'radio1.he_mu_edca_ac_vi_timer',
    'radio1.he_mu_edca_ac_vo_timer',
    'radio1.he_spr_non_srg_obss_pd_max_offset',
    'radio1.he_spr_sr_control',
    'radio1.he_twt_responder',
  ]);
  // nothing of the network: its name, password, channel and on/off stay as LuCI or the other page left them
  assert.deepEqual(touched(driverChanges(before, before)), []);
});

test('each page sees only its own edits as unsaved', () => {
  const [before] = two();
  assert.ok(before !== undefined);
  assert.equal(networkChanged({ ...before, airtime: false, twt: { ...before.twt, maxIntervalMs: 1000 } }, before), false);
  assert.equal(driverChanged({ ...before, airtime: false }, before), true);
  assert.equal(driverChanged({ ...before, key: 'another password' }, before), false);
  assert.equal(networkChanged({ ...before, key: 'another password' }, before), true);
});

test('validation is split the same way', () => {
  const f = band('radio0', '2g', { key: 'short', airtimeBands: { ...airtimeBandDefaults('2g'), full: 'x', auto: 'manual' } });
  assert.deepEqual(Object.keys(validateNetwork(f)), ['key']);
  assert.ok(Object.keys(validateDriver(f)).includes('full'));
  // with the policy off its settings aren't saved, so they can't block a save
  assert.deepEqual(validateDriver({ ...f, airtime: false }), {});
});

test('the driver’s own options for every band go to milkflint.wifi', () => {
  const forms = two().map((f) => ({
    ...f,
    spr: { mode: 'off' as const, threshold: -72 },
    airtime: false,
    muru: f.band === '5g' ? { mimoDl: false, ofdmaDl: true, mimoUl: true, ofdmaUl: false } : f.muru,
  }));
  const section = driverSection(forms);
  assert.equal(section['spr_2g'], 'off');
  assert.equal(section['spr_5g'], 'off');
  assert.equal(section['airtime_5g'], undefined);
  assert.equal(section['muru_5g_mimo_dl'], '0');
  assert.equal(section['muru_5g_ofdma_dl'], undefined);
  assert.equal(section['muru_5g_mimo_ul'], '1');
  assert.equal(section['muru_5g_ofdma_ul'], undefined);
  assert.ok('twt_5g_max_interval' in section);
});

test('a new password: that band’s devices must join again, this one too if it’s there', () => {
  const saved = two();
  const forms = saved.map((f) => (f.band === '5g' ? { ...f, key: 'another password' } : f));
  const impacts = networkImpacts(forms, saved, false, options);
  assert.deepEqual(impacts, [{ band: '5g', kind: 'rejoin', changed: ['password'], radarS: 0 }]);
  assert.deepEqual(impactLines(impacts), [
    'Devices on 5 GHz disconnect and must join again with the new password, this one too if it’s connected there.',
  ]);
});

test('a new name and password on both bands are said once for both', () => {
  const saved = two();
  const forms = saved.map((f) => ({ ...f, ssid: 'other', key: 'another password' }));
  assert.deepEqual(impactLines(networkImpacts(forms, saved, false, options)), [
    'Devices on 2.4 GHz and 5 GHz disconnect and must join again with the new name and password, this one too if it’s connected to one of them.',
  ]);
  // on Auto with radar channels allowed, 5 GHz may pick one: only it waits for a radar check
  const auto = saved.map((f) => (f.band === '5g' ? { ...f, channel: 'auto' } : f));
  assert.deepEqual(
    impactLines(
      networkImpacts(
        auto.map((f) => ({ ...f, ssid: 'other' })),
        auto,
        false,
        options,
      ),
    ),
    [
      'Devices on 2.4 GHz and 5 GHz disconnect and must join again with the new name, this one too if it’s connected to one of them. 5 GHz then stays off for about a minute while the router listens for radar.',
    ],
  );
});

test('a radio change restarts its band, with the radar check a radar channel needs', () => {
  const saved = two();
  const forms = saved.map((f) => (f.band === '5g' ? { ...f, channel: '52' } : f));
  const impacts = networkImpacts(forms, saved, false, options);
  assert.deepEqual(impacts, [{ band: '5g', kind: 'restart', changed: [], radarS: 60 }]);
  assert.deepEqual(impactLines(impacts), [
    'Saving restarts 5 GHz: devices on it drop and reconnect by themselves, this one too if it’s connected there. 5 GHz then stays off for about a minute while the router listens for radar.',
  ]);
  assert.match(radarNote(60) ?? '', /about a minute/);
  assert.equal(radarNote(0), undefined);
});

test('a new country restarts every band that is on; a band that was off drops nobody', () => {
  const saved = [band('radio0', '2g'), band('radio1', '5g', { enabled: false })];
  const impacts = networkImpacts(saved, saved, true, options);
  assert.deepEqual(
    impacts.map((i) => [i.band, i.kind]),
    [['2g', 'restart']],
  );
  // turning a band on drops nobody either
  const on = saved.map((f) => ({ ...f, enabled: true }));
  assert.deepEqual(networkImpacts(on, saved, false, options), []);
});

test('turning a band off, or every band', () => {
  const saved = two();
  const off5 = saved.map((f) => (f.band === '5g' ? { ...f, enabled: false } : f));
  assert.deepEqual(impactLines(networkImpacts(off5, saved, false, options)), [
    '5 GHz turns off: its devices lose Wi-Fi, this one too if it’s connected there.',
  ]);
  const allOff = saved.map((f) => ({ ...f, enabled: false }));
  assert.deepEqual(impactLines(networkImpacts(allOff, saved, false, options), true), [
    'Wi-Fi turns off on every band: devices on it lose their connection, this one too if it’s on Wi-Fi. A cable still reaches the router.',
  ]);
});

test('a driver save restarts only bands whose wireless config it changes', () => {
  const saved = two();
  // the driver's own spatial reuse mode, live MURU flags and airtime policy apply at once, without a restart
  const atOnce = saved.map((f) => ({
    ...f,
    spr: { mode: 'off' as const, threshold: -72 },
    airtime: false,
    muru: { mimoDl: false, ofdmaDl: false, mimoUl: false, ofdmaUl: false },
  }));
  assert.deepEqual(driverImpacts(atOnce, saved, options), []);
  const restart = saved.map((f) => (f.band === '2g' ? { ...f, holdBack: 'openwrt' as const } : f));
  assert.deepEqual(driverImpacts(restart, saved, options), [{ band: '2g', kind: 'restart', changed: [], radarS: 0 }]);
});
