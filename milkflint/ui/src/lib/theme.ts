// The theme and its light/dark scheme. Both are attributes on <html>
// (data-theme, and data-darkmode, the one LuCI's themes use), which the theme
// CSS keys on; switching is CSS only, so nothing remounts and charts follow.
//
// The theme is the router's: every device that opens the interface shows the
// one chosen on the Themes page, and the custom themes made there are kept on
// the router too (lib/api/themes.ts). Light or dark is each device's own.
// This browser keeps a copy of the router's choice and the custom themes' CSS
// so index.html can paint the right theme before the router has answered.
import { useSyncExternalStore } from 'react';
import { getThemeSettings, setThemeSettings } from '@/lib/api/themes';
import type { Theme } from '@/theme/contract';
import { themeCss } from '@/theme/css';
import { type CustomTheme, parseSettings, resolveCustom, type ThemeSettings } from '@/theme/custom';
import { DEFAULT_THEME_ID, themes as builtIn } from '@/theme/themes';

/** Light or dark; "system" follows the device. */
export type SchemeChoice = 'light' | 'dark' | 'system';
/** Kept for the scheme switch's existing callers. */
export type ThemeChoice = SchemeChoice;

// The keys index.html reads too.
const SCHEME_KEY = 'milkflint.theme';
const THEME_KEY = 'milkflint.theme-id';
const CUSTOM_KEY = 'milkflint.theme-custom';
const CSS_KEY = 'milkflint.theme-css';
const STYLE_ID = 'mf-custom-themes';
const PREVIEW_ID = 'mf-theme-preview';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not kept, but still applied for this page.
  }
}

function cachedSettings(): ThemeSettings {
  let custom: unknown;
  try {
    custom = JSON.parse(load(CUSTOM_KEY) ?? '[]');
  } catch {
    custom = [];
  }
  return parseSettings({ theme: load(THEME_KEY), custom });
}

const storedScheme = load(SCHEME_KEY);
let scheme: SchemeChoice = storedScheme === 'light' || storedScheme === 'dark' ? storedScheme : 'system';
let settings: ThemeSettings = cachedSettings();
let custom: readonly Theme[] = settings.custom.map((c) => resolveCustom(c, builtIn));
let version = 0;
let snapshot = '';
// none where there's no page: the tests import modules that import this one
const media = typeof window === 'undefined' ? undefined : window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function fallback(): Theme {
  const theme = builtIn.find((t) => t.id === DEFAULT_THEME_ID);
  if (theme === undefined) throw new Error('the default theme is missing from src/theme/themes');
  return theme;
}

/** A built-in or custom theme by id; the default when there's none. */
export function themeById(id: string): Theme {
  return builtIn.find((t) => t.id === id) ?? custom.find((t) => t.id === id) ?? fallback();
}

function styleElement(id: string): HTMLStyleElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLStyleElement) return existing;
  const el = document.createElement('style');
  el.id = id;
  document.head.append(el);
  return el;
}

function writeCustomCss(): void {
  const css = custom.length === 0 ? '' : themeCss(custom, { root: false });
  styleElement(STYLE_ID).textContent = css;
  keep(CSS_KEY, css === '' ? null : css);
  keep(CUSTOM_KEY, settings.custom.length === 0 ? null : JSON.stringify(settings.custom));
}

function apply(): void {
  const theme = themeById(settings.theme ?? DEFAULT_THEME_ID);
  const hasDark = theme.schemes.dark !== undefined;
  const hasLight = theme.schemes.light !== undefined;
  const wantsDark = scheme === 'dark' || (scheme === 'system' && media?.matches === true);
  const dark = hasDark && (wantsDark || !hasLight);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.setAttribute('data-darkmode', dark ? 'true' : 'false');
  snapshot = `${scheme}:${theme.id}:${dark ? 'dark' : 'light'}:${String(version)}`;
  for (const listener of listeners) listener();
}

/** Takes the router's settings as this page's (and this browser's copy). */
function adopt(next: ThemeSettings): void {
  settings = next;
  custom = next.custom.map((c) => resolveCustom(c, builtIn));
  version++;
  keep(THEME_KEY, next.theme === null || next.theme === DEFAULT_THEME_ID ? null : next.theme);
  writeCustomCss();
  apply();
}

if (media !== undefined) {
  writeCustomCss();
  apply();
  media.addEventListener('change', apply);
}

/** Light, dark or follow the device: this device's own choice. */
export function setTheme(next: SchemeChoice): void {
  scheme = next;
  keep(SCHEME_KEY, next === 'system' ? null : next);
  apply();
}

/** What the router keeps, read once signed in; a router without it keeps the copy. */
export async function syncThemes(): Promise<void> {
  try {
    adopt(await getThemeSettings());
  } catch {
    // an older router, or not signed in yet: this browser's copy stands
  }
}

/**
 * Changes what the router keeps: read the latest first, so a change made on
 * another device meanwhile isn't lost, change it, save, and show the result.
 */
async function change(edit: (s: ThemeSettings) => ThemeSettings): Promise<void> {
  const next = edit(await getThemeSettings());
  await setThemeSettings(next);
  adopt(next);
}

/** The theme every device shows. Shown here at once; saved on the router (throws if it couldn't be). */
export async function setThemeId(id: string): Promise<void> {
  const before = settings;
  adopt({ ...settings, theme: themeById(id).id });
  try {
    await change((s) => ({ ...s, theme: themeById(id).id }));
  } catch (e) {
    adopt(before);
    throw e;
  }
}

/** Adds or replaces a custom theme; `use` makes it the theme every device shows. */
export async function saveCustomTheme(theme: CustomTheme, { use = false }: { use?: boolean } = {}): Promise<void> {
  await change((s) => {
    const others = s.custom.filter((c) => c.id !== theme.id);
    const at = s.custom.findIndex((c) => c.id === theme.id);
    const list = at === -1 ? [...others, theme] : [...others.slice(0, at), theme, ...others.slice(at)];
    return { theme: use ? theme.id : s.theme, custom: list };
  });
}

/** Removes a custom theme; if it was in use, the default takes over. */
export async function deleteCustomTheme(id: string): Promise<void> {
  await change((s) => ({ theme: s.theme === id ? null : s.theme, custom: s.custom.filter((c) => c.id !== id) }));
}

/**
 * The editor's draft under its own id, for the preview beside it (the page
 * itself keeps the theme in use); undefined takes it away.
 */
export function previewTheme(theme: Theme | undefined): void {
  styleElement(PREVIEW_ID).textContent = theme === undefined ? '' : themeCss([theme], { root: false });
}

export interface ThemeState {
  choice: SchemeChoice;
  dark: boolean;
  theme: Theme;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeState {
  const key = useSyncExternalStore(subscribe, () => snapshot);
  const [choice, id, mode] = key.split(':');
  return { choice: (choice ?? 'system') as SchemeChoice, dark: mode === 'dark', theme: themeById(id ?? DEFAULT_THEME_ID) };
}

/** The built-in themes a viewer may pick from (hidden ones too, in development). */
export function pickableThemes(): readonly Theme[] {
  return builtIn.filter((t) => t.hidden !== true || import.meta.env.DEV);
}

export interface ThemesState {
  builtIn: readonly Theme[];
  custom: readonly { saved: CustomTheme; theme: Theme }[];
  /** The theme every device shows. */
  current: string;
}

/** The Themes page's view: every theme to pick from, and the one in use. */
export function useThemes(): ThemesState {
  useSyncExternalStore(subscribe, () => snapshot);
  return {
    builtIn: pickableThemes(),
    custom: settings.custom.map((saved, i) => ({ saved, theme: custom[i] ?? themeById(saved.id) })),
    current: themeById(settings.theme ?? DEFAULT_THEME_ID).id,
  };
}
