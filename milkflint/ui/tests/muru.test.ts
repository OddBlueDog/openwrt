import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MURU_ALL_OFF,
  MURU_DEFAULTS,
  muruDriverOptions,
  muruEnabled,
  muruNow,
  muruOf,
  muruWithMaster,
} from '../src/features/wifi/muru.ts';

test('muruOf: defaults have download on and upload off', () => {
  assert.deepEqual(
    muruOf(() => undefined),
    MURU_DEFAULTS,
  );
  assert.equal(muruEnabled(MURU_DEFAULTS), true);
  assert.equal(muruEnabled(MURU_ALL_OFF), false);
});

test('muruOf: parses explicit 0/1 flags and ignores invalid values', () => {
  const vals: Record<string, string> = {
    mimo_dl: '0',
    ofdma_dl: '1',
    mimo_ul: '1',
    ofdma_ul: 'yes',
  };
  assert.deepEqual(
    muruOf((name) => vals[name]),
    { mimoDl: false, ofdmaDl: true, mimoUl: true, ofdmaUl: false },
  );
});

test('muruWithMaster: on restores download-on / upload-off defaults, off clears all four', () => {
  assert.deepEqual(muruWithMaster(true), { mimoDl: true, ofdmaDl: true, mimoUl: false, ofdmaUl: false });
  assert.deepEqual(muruWithMaster(false), { mimoDl: false, ofdmaDl: false, mimoUl: false, ofdmaUl: false });
});

test('muruDriverOptions: defaults are unset, overrides write 0 for download and 1 for upload', () => {
  assert.deepEqual(muruDriverOptions('5g', MURU_DEFAULTS), {
    muru_5g_mimo_dl: undefined,
    muru_5g_ofdma_dl: undefined,
    muru_5g_mimo_ul: undefined,
    muru_5g_ofdma_ul: undefined,
  });
  assert.deepEqual(muruDriverOptions('2g', MURU_ALL_OFF), {
    muru_2g_mimo_dl: '0',
    muru_2g_ofdma_dl: '0',
    muru_2g_mimo_ul: undefined,
    muru_2g_ofdma_ul: undefined,
  });
  assert.deepEqual(muruDriverOptions('5g', { mimoDl: true, ofdmaDl: false, mimoUl: true, ofdmaUl: true }), {
    muru_5g_mimo_dl: undefined,
    muru_5g_ofdma_dl: '0',
    muru_5g_mimo_ul: '1',
    muru_5g_ofdma_ul: '1',
  });
});

const wifi6 = { wifi6: true, muMimo: true };

test('muruNow: summarises live flags only when running and supported', () => {
  assert.equal(muruNow(undefined, wifi6), '');
  assert.equal(
    muruNow({ running: false, supported: true, ofdma_dl: true, ofdma_ul: false, mimo_dl: true, mimo_ul: false }, wifi6),
    '',
  );
  assert.equal(
    muruNow({ running: true, supported: false, ofdma_dl: null, ofdma_ul: null, mimo_dl: null, mimo_ul: null }, wifi6),
    '',
  );
  assert.equal(
    muruNow({ running: true, supported: true, ofdma_dl: true, ofdma_ul: false, mimo_dl: true, mimo_ul: false }, wifi6),
    'In use now: download MU-MIMO, download OFDMA.',
  );
  assert.equal(
    muruNow({ running: true, supported: true, ofdma_dl: false, ofdma_ul: false, mimo_dl: false, mimo_ul: false }, wifi6),
    'In use now: all off.',
  );
  assert.equal(
    muruNow({ running: true, supported: true, ofdma_dl: true, ofdma_ul: true, mimo_dl: true, mimo_ul: true }, wifi6),
    'In use now: download MU-MIMO, download OFDMA, upload MU-MIMO, upload OFDMA.',
  );
});

test('muruNow: leaves out what the band cannot use', () => {
  const all = { running: true, supported: true, ofdma_dl: true, ofdma_ul: true, mimo_dl: true, mimo_ul: true };
  // MU-MIMO off in Networks & radios: the driver sends no downlink MU-MIMO, whatever its flag says
  assert.equal(muruNow(all, { wifi6: true, muMimo: false }), 'In use now: download OFDMA, upload MU-MIMO, upload OFDMA.');
  // Wi-Fi 5: no OFDMA and no uplink multi-user
  assert.equal(muruNow(all, { wifi6: false, muMimo: true }), 'In use now: download MU-MIMO.');
  assert.equal(muruNow(all, { wifi6: false, muMimo: false }), 'In use now: all off.');
});
