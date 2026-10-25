// Light/dark choice: "system" follows the OS. Stored per browser.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'milkflint.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Storage blocked: follow the system.
  }
  return 'system';
}

let choice: ThemeChoice = stored();

function apply(): void {
  const dark = choice === 'dark' || (choice === 'system' && media.matches);
  document.documentElement.setAttribute('data-darkmode', dark ? 'true' : 'false');
}

media.addEventListener('change', () => {
  apply();
  for (const listener of listeners) listener();
});

export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Not saved, but still applied for this page.
  }
  apply();
  for (const listener of listeners) listener();
}

export function useTheme(): { choice: ThemeChoice; dark: boolean } {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${choice}:${document.documentElement.getAttribute('data-darkmode') ?? 'false'}`,
  );
  const [c, d] = current.split(':');
  return { choice: (c ?? 'system') as ThemeChoice, dark: d === 'true' };
}
