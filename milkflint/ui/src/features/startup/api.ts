// The Startup page: the services in /etc/init.d through rpcd's rc object
// (list them, start, stop, restart, reload, turn on or off at boot), and
// /etc/rc.local through its file object, as LuCI's Startup page does. The
// feature's ACL allows those.
import { z } from 'zod';
import { readText, writeText } from '@/lib/api/files';
import { call, exec } from '@/lib/ubus';
import { type Service, servicesOf } from './model';

export const RC_LOCAL = '/etc/rc.local';

const rcList = z.record(
  z.string(),
  z.object({
    start: z.number().optional(),
    stop: z.number().optional(),
    enabled: z.boolean(),
    running: z.boolean().optional(),
  }),
);

export async function getServices(): Promise<Service[]> {
  return servicesOf(await call('rc', 'list', {}, rcList));
}

export type InitAction = 'start' | 'restart' | 'reload' | 'stop' | 'enable' | 'disable';

/** /etc/init.d/<name> <action>, through procd's rc. */
export function runInit(name: string, action: InitAction): Promise<void> {
  return exec('rc', 'init', { name, action });
}

export function readRcLocal(): Promise<string> {
  return readText(RC_LOCAL);
}

export function saveRcLocal(text: string, before: string): Promise<void> {
  return writeText(RC_LOCAL, text, before, 0o644);
}
