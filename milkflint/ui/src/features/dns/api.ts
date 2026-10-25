import { z } from 'zod';
import { call } from '@/lib/ubus';

/** Whether the encrypted-DNS proxy (AdGuard's dnsproxy) is installed, and whether it's running. */
export function getDnsStatus(): Promise<{ installed: boolean; running: boolean }> {
  return call('milkflint.dns', 'status', {}, z.object({ installed: z.boolean(), running: z.boolean() }));
}
