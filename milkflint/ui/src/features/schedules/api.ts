// root's crontab on the router, read and written through rpcd's file object
// as LuCI's Scheduled Tasks does (the feature's ACL allows that one file and
// cron's enable and reload): the router's cron runs it, on its own clock.
import { z } from 'zod';
import { call, exec, UbusError, UbusStatus } from '@/lib/ubus';

export const CRONTAB = '/etc/crontabs/root';

const execResult = z.object({ code: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }).loose();

/** The crontab's text; empty when there's none yet. */
export async function readCrontab(): Promise<string> {
  try {
    return (await call('file', 'read', { path: CRONTAB }, z.object({ data: z.string() }))).data;
  } catch (err) {
    if (err instanceof UbusError && err.code === UbusStatus.notFound) return '';
    throw err;
  }
}

async function cron(action: 'enable' | 'reload'): Promise<void> {
  const r = await call('file', 'exec', { command: '/etc/init.d/cron', params: [action] }, execResult);
  if (r.code === 0) return;
  const said = (r.stderr ?? r.stdout ?? '').trim();
  throw new Error(`cron’s ${action} failed: ${said === '' ? `exit ${String(r.code)}` : said}`);
}

/**
 * Write the crontab, if it's still what the page read (`before`): banIP's
 * page, LuCI or a shell may have changed it since, and that isn't lost. Then
 * cron starts at boot, and takes the new file now (its reload restarts it
 * only when the file changed).
 */
export async function saveCrontab(text: string, before: string): Promise<void> {
  if ((await readCrontab()) !== before)
    throw new Error('The crontab changed on the router since this page read it. Reload the page, then make the change again.');
  await exec('file', 'write', { path: CRONTAB, data: text, mode: 0o600 });
  await cron('enable');
  await cron('reload');
}
