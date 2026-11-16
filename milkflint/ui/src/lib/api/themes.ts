// The theme every device shows and the custom themes, kept on the router
// (source/feed/milkflint-ui/files/features/themes/rpcd.uc).
import { z } from 'zod';
import { call } from '@/lib/ubus';
import { parseSettings, type ThemeSettings } from '@/theme/custom';

export async function getThemeSettings(): Promise<ThemeSettings> {
  return parseSettings(await call('milkflint.themes', 'get', {}, z.unknown()));
}

const saveReply = z.union([z.object({ saved: z.literal(true) }), z.object({ error: z.string() })]);

/** Replaces what the router keeps. */
export async function setThemeSettings(settings: ThemeSettings): Promise<void> {
  const reply = await call('milkflint.themes', 'set', { theme: settings.theme ?? '', custom: settings.custom }, saveReply);
  if ('error' in reply) throw new Error(`The router didn’t save the themes (${reply.error}).`);
}
