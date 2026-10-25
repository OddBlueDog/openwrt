// Login state. The router issues a session id (rpcd's ubus session, the same
// kind LuCI uses); it lives in sessionStorage, so it ends with the tab.
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { call, callAnonymous, exec, NULL_SESSION, onSessionExpired, setSessionId } from './ubus';

const STORAGE_KEY = 'milkflint.session';

/**
 * The admin password earlier MilkFlint images gave a fresh install. A fresh
 * install now has none, as on OpenWrt; a router upgraded from one of those
 * images with its settings kept may still have this one.
 */
export const OLD_DEFAULT_PASSWORD = 'password';

/** The admin (root) password: none set (anyone can sign in), still the old default, or set. */
export type AdminPassword = 'none' | 'old-default' | 'set';

export type SessionState =
  | { status: 'anonymous'; reason?: 'expired' | 'logged-out' }
  | { status: 'authenticated'; id: string; username: string; adminPassword: AdminPassword };

function readStored(): SessionState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = z
        .object({ id: z.string().length(32), username: z.string(), adminPassword: z.enum(['none', 'old-default', 'set']).default('set') })
        .safeParse(JSON.parse(raw));
      if (parsed.success) return { status: 'authenticated', ...parsed.data };
    }
  } catch {
    // Storage blocked or corrupt: start logged out.
  }
  return { status: 'anonymous' };
}

let state: SessionState = readStored();
if (state.status === 'authenticated') setSessionId(state.id);
const listeners = new Set<() => void>();

function update(next: SessionState): void {
  state = next;
  setSessionId(next.status === 'authenticated' ? next.id : NULL_SESSION);
  try {
    if (next.status === 'authenticated') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: next.id, username: next.username, adminPassword: next.adminPassword }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: the session just won't survive a reload.
  }
  for (const listener of listeners) listener();
}

onSessionExpired(() => {
  if (state.status === 'authenticated') update({ status: 'anonymous', reason: 'expired' });
});

const loginResult = z.object({
  ubus_rpc_session: z.string().length(32),
  data: z.object({ username: z.string() }).partial().optional(),
});

/** Throws UbusError (permission denied) for a wrong username or password. */
export async function login(username: string, password: string): Promise<void> {
  const res = await callAnonymous('session', 'login', { username, password, timeout: 3600 }, loginResult);
  // While the account has no password the router takes any, so ask it.
  // A router without the call: an empty password is the likely sign.
  setSessionId(res.ubus_rpc_session);
  const set = await call('milkflint.adminpassword', 'status', {}, z.object({ set: z.boolean() })).then(
    (r) => r.set,
    () => password !== '',
  );
  update({
    status: 'authenticated',
    id: res.ubus_rpc_session,
    username: res.data?.username ?? username,
    adminPassword: !set ? 'none' : password === OLD_DEFAULT_PASSWORD ? 'old-default' : 'set',
  });
}

/** After the admin password changes. */
export function setAdminPassword(adminPassword: AdminPassword): void {
  if (state.status === 'authenticated') update({ ...state, adminPassword });
}

export async function logout(): Promise<void> {
  try {
    await exec('session', 'destroy');
  } finally {
    update({ status: 'anonymous', reason: 'logged-out' });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state);
}
