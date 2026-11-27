// A value kept in this browser's localStorage under one key: read once and
// cached, written on save, and followed at once by every component using it.
// Storage that is missing or throws (a private window) leaves the value for
// this page only.
import { useSyncExternalStore } from 'react';

export interface Stored<T> {
  get(): T;
  /** Keep `value` (undefined: remove the key and go back to the fallback). */
  save(value: T | undefined): void;
  use(): T;
}

export function storedValue<T>(key: string, parse: (raw: unknown) => T, fallback: () => T): Stored<T> {
  let current: { value: T } | undefined;
  const listeners = new Set<() => void>();

  const get = (): T => {
    if (current === undefined) {
      try {
        current = { value: parse(JSON.parse(localStorage.getItem(key) ?? 'null')) };
      } catch {
        current = { value: fallback() };
      }
    }
    return current.value;
  };

  const save = (value: T | undefined): void => {
    current = { value: value ?? fallback() };
    try {
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // kept for this page only
    }
    for (const l of listeners) l();
  };

  const subscribe = (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };

  const use = (): T => useSyncExternalStore(subscribe, get);

  return { get, save, use };
}
