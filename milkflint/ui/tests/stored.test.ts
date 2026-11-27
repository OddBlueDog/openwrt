// The shared localStorage store: the fallback, what a save writes and removes,
// and storage that throws (kept for this page only).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storedValue } from '../src/lib/stored.ts';

const parse = (v: unknown): number => (typeof v === 'number' ? v : 7);

function stub(data: Map<string, string>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
}

test('no value: the fallback', () => {
  stub(new Map());
  assert.equal(storedValue('k1', parse, () => 7).get(), 7);
});

test('a saved value comes back from storage', () => {
  const data = new Map<string, string>();
  stub(data);
  storedValue('k2', parse, () => 7).save(42);
  assert.equal(storedValue('k2', parse, () => 7).get(), 42);
});

test('bad JSON: the fallback', () => {
  stub(new Map([['k3', '{']]));
  assert.equal(storedValue('k3', parse, () => 7).get(), 7);
});

test('save(undefined) removes the key', () => {
  const data = new Map<string, string>();
  stub(data);
  const s = storedValue('k4', parse, () => 7);
  s.save(5);
  assert.equal(data.get('k4'), '5');
  s.save(undefined);
  assert.equal(data.has('k4'), false);
  assert.equal(s.get(), 7);
});

test('storage that throws: kept for this page only', () => {
  const boom = (): never => {
    throw new Error('no storage');
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: boom, setItem: boom, removeItem: boom },
  });
  const s = storedValue('k5', parse, () => 7);
  assert.equal(s.get(), 7);
  assert.doesNotThrow(() => {
    s.save(9);
  });
  assert.equal(s.get(), 9);
});
