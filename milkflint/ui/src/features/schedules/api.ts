// root's crontab on the router, read and written through rpcd's file object
// as LuCI's Scheduled Tasks does (the feature's ACL allows that one file and
// cron's enable and reload): the router's cron runs it, on its own clock.
import { z } from 'zod';
import { readText, writeText } from '@/lib/api/files';
import { call } from '@/lib/ubus';

export const CRONTAB = '/etc/crontabs/root';

const execResult = z.object({ code: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }).loose();

/** The crontab's text; empty when there's none yet. */
export function readCrontab(): Promise<string> {
  return readText(CRONTAB);
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
  await writeText(CRONTAB, text, before, 0o600);
  await cron('enable');
  await cron('reload');
}
