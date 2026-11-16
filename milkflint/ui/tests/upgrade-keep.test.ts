// Whether an upgrade starts out keeping the settings: on from MilkFlint to a
// MilkFlint image, off for anything else, with the reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { erasedText, imageKind, keepChoice } from '../src/features/upgrade/keep.ts';

const MILKFLINT = 'milkflint-0.81a-mediatek-filogic-glinet_gl-mt6000-squashfs-sysupgrade.bin';
const OPENWRT = 'openwrt-25.12.0-mediatek-filogic-glinet_gl-mt6000-squashfs-sysupgrade.bin';
const SNAPSHOT = 'openwrt-mediatek-filogic-glinet_gl-mt6000-squashfs-sysupgrade.bin';
const GLINET = 'openwrt-mt6000-4.7.4-0925-1727266862.bin';

test('the image is told by its name', () => {
  assert.equal(imageKind(MILKFLINT), 'milkflint');
  assert.equal(imageKind('MilkFlint-0.9a-sysupgrade.bin'), 'milkflint');
  assert.equal(imageKind(OPENWRT), 'openwrt');
  assert.equal(imageKind(SNAPSHOT), 'openwrt');
  assert.equal(imageKind(GLINET), 'glinet');
  assert.equal(imageKind('gl-mt6000-4.6.8.bin'), 'glinet');
  assert.equal(imageKind('firmware.bin'), 'unknown');
  assert.equal(imageKind('immortalwrt-24.10.0-mediatek-filogic-glinet_gl-mt6000-squashfs-sysupgrade.bin'), 'unknown');
});

test('MilkFlint to a MilkFlint image keeps the settings', () => {
  const c = keepChoice({ running: 'MilkFlint', image: MILKFLINT, allowBackup: true });
  assert.equal(c.keep, true);
  assert.equal(c.allowed, true);
  assert.match(c.reason, /keeps your settings/);
});

test('a check that says nothing of backups still keeps them for MilkFlint', () => {
  assert.equal(keepChoice({ running: 'MilkFlint', image: MILKFLINT, allowBackup: undefined }).keep, true);
});

test('stock OpenWrt and GL.iNet images start with factory settings, and say why', () => {
  const openwrt = keepChoice({ running: 'MilkFlint', image: OPENWRT, allowBackup: true });
  assert.equal(openwrt.keep, false);
  assert.equal(openwrt.allowed, true);
  assert.match(openwrt.reason, /OpenWrt/);
  const gl = keepChoice({ running: 'MilkFlint', image: GLINET, allowBackup: true });
  assert.equal(gl.keep, false);
  assert.match(gl.reason, /GL\.iNet/);
});

test('a name that says nothing keeps nothing unless the user turns it on', () => {
  const c = keepChoice({ running: 'MilkFlint', image: 'firmware.bin', allowBackup: true });
  assert.equal(c.keep, false);
  assert.equal(c.allowed, true);
  assert.equal(c.kind, 'unknown');
  assert.match(c.reason, /doesn’t say/);
});

test('an image that can’t keep settings can’t, whatever its name', () => {
  const c = keepChoice({ running: 'MilkFlint', image: MILKFLINT, allowBackup: false });
  assert.equal(c.keep, false);
  assert.equal(c.allowed, false);
});

test('a router not on MilkFlint, or one not known yet, starts afresh', () => {
  assert.equal(keepChoice({ running: 'OpenWrt', image: MILKFLINT, allowBackup: true }).keep, false);
  assert.match(keepChoice({ running: 'OpenWrt', image: MILKFLINT, allowBackup: true }).reason, /runs OpenWrt/);
  const unknown = keepChoice({ running: undefined, image: MILKFLINT, allowBackup: true });
  assert.equal(unknown.keep, false);
  assert.match(unknown.reason, /Couldn’t read/);
});

test('erasing says Wi-Fi is off and a cable is needed, except on GL.iNet’s firmware', () => {
  assert.match(erasedText('milkflint'), /Wi-Fi off: only a device on a cable/);
  assert.match(erasedText('unknown'), /192\.168\.1\.1/);
  assert.doesNotMatch(erasedText('glinet'), /192\.168\.1\.1/);
});
