// MilkFlint's package updater (rpcd milkflint.packages): the versions its
// feed has tested with this release for a package with an update hook
// (AdGuard Home, banIP), and the Check and Install that run in the background.
import { z } from 'zod';
import { call } from '@/lib/ubus';

export type PackageName = 'adguardhome' | 'banip';

export const updateSchema = z.object({
  busy: z.boolean().nullish(),
  /** An install waiting for another package's to finish (one at a time). */
  waiting: z.boolean().nullish(),
  action: z.string().nullish(),
  checked: z.number().nullish(),
  /** The installed package's version, from the apk database. */
  installed: z.string().nullish(),
  latest: z.string().nullish(),
  /** The feed's versions tested with this release, newest first. */
  versions: z.array(z.string()).nullish(),
  /** Installed as an earlier one (milkflint.pkgupdate.<name>_pinned in UCI). */
  pinned: z.string().nullish(),
  ok: z.boolean().nullish(),
  /** What went wrong: 'feed', 'version', 'install', 'settings' or 'after' (it didn't work with that version). */
  error: z.string().nullish(),
  /** After a failed install: whether the version that was there went back on. */
  back_on: z.boolean().nullish(),
  log: z.string().nullish(),
  finished: z.number().nullish(),
});
export type UpdateInfo = z.output<typeof updateSchema>;

const resultSchema = z.object({ ok: z.boolean().optional(), error: z.string().optional() });

const errors: Record<string, string> = {
  name: 'That package has no updater.',
  version: 'That version isn’t in MilkFlint’s package feed.',
  busy: 'An update is running already.',
};

async function act(method: string, params: Record<string, unknown>): Promise<void> {
  const r = await call('milkflint.packages', method, params, resultSchema);
  if (r.error !== undefined) throw new Error(errors[r.error] ?? `The router couldn’t: ${r.error}.`);
}

export function getPackageStatus(name: PackageName): Promise<UpdateInfo> {
  return call('milkflint.packages', 'status', { name }, updateSchema);
}

/** Looks up the feed's tested versions, in the background. */
export async function checkPackage(name: PackageName): Promise<void> {
  await act('check', { name });
}

/** Installs that version from MilkFlint's feed ('' for the newest), in the background. */
export async function installPackage(name: PackageName, version: string): Promise<void> {
  await act('install', { name, version });
}
