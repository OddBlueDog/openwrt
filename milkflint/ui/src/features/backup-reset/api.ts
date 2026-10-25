import { exec, getSessionId, routerHealth } from '@/lib/ubus';

/** Download a configuration backup (OpenWrt's cgi-io, like LuCI). */
export async function downloadBackup(): Promise<Blob> {
  const res = await fetch('/cgi-bin/cgi-backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionid: getSessionId() }),
  });
  if (!res.ok) throw new Error(`The router answered ${String(res.status)}.`);
  return res.blob();
}

/**
 * Erase all settings and restart. The router replies first, then resets
 * (milkflint.maintenance in this feature's rpcd plugin).
 */
export function factoryReset(): Promise<void> {
  return exec('milkflint.maintenance', 'factory_reset');
}

/** Where a restart has got to, as seen from the browser. */
export type RestartPhase = 'starting' | 'offline' | 'back';

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * Follow the router through a restart, then reload the page. It checks the
 * router every 2 s: it's back once it answers but no longer knows this
 * page's login (sessions don't survive a restart), so a check that lands
 * before it has gone down can't reload into the old firmware. If it still
 * knows the login after `giveUpMs` it never restarted: the page reloads
 * anyway and can say so.
 */
export async function waitForRouterAndReload(onPhase?: (phase: RestartPhase) => void, giveUpMs = 240_000): Promise<never> {
  const session = getSessionId();
  const start = Date.now();
  let offline = false;
  for (;;) {
    await sleep(2000);
    const health = await routerHealth(session, 3000);
    if (health === 'restarted') break;
    if (health === 'down') {
      if (!offline) onPhase?.('offline');
      offline = true;
    } else if (Date.now() - start > giveUpMs) {
      break;
    }
  }
  onPhase?.('back');
  await sleep(1000);
  window.location.reload();
  return new Promise<never>(() => undefined);
}
