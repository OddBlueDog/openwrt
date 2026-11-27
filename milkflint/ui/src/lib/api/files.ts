// Files on the router, read and written through rpcd's file object as
// LuCI's pages do. Each feature's ACL names the files its page may touch.
import { z } from 'zod';
import { call, exec, UbusError, UbusStatus } from '@/lib/ubus';

/** A file's text; empty when there's no such file. */
export async function readText(path: string): Promise<string> {
  try {
    return (await call('file', 'read', { path }, z.object({ data: z.string() }))).data;
  } catch (err) {
    if (err instanceof UbusError && err.code === UbusStatus.notFound) return '';
    throw err;
  }
}

/**
 * Write a file, if it's still what the page read (`before`): another page,
 * LuCI or a shell may have changed it since, and that isn't lost.
 */
export async function writeText(path: string, text: string, before: string, mode: number): Promise<void> {
  if ((await readText(path)) !== before)
    throw new Error(`${path} changed on the router since this page read it. Reload the page, then make the change again.`);
  await exec('file', 'write', { path, data: text, mode });
}
