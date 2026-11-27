// OpenWrt's configuration (UCI) through rpcd. Changes are staged in this
// session's own change set, then applied together: unchecked, or with
// rollback armed (the router undoes them unless the browser confirms).
import { z } from 'zod';
import { call, exec, UbusError, UbusStatus } from '@/lib/ubus';

const optionValue = z.union([z.string(), z.array(z.string())]);
const sectionSchema = z
  .object({
    '.type': z.string(),
    '.name': z.string(),
    '.anonymous': z.boolean().optional(),
    '.index': z.number().optional(),
  })
  .catchall(optionValue);
export type Section = z.output<typeof sectionSchema>;

/** All sections of a config, in file order. */
export async function getConfig(config: string): Promise<Section[]> {
  const res = await call('uci', 'get', { config }, z.object({ values: z.record(z.string(), sectionSchema) }));
  return Object.values(res.values).sort((a, b) => (a['.index'] ?? 0) - (b['.index'] ?? 0));
}

export function str(s: Section | undefined, option: string): string | undefined {
  const v = s?.[option];
  return typeof v === 'string' ? v : undefined;
}

export function list(s: Section | undefined, option: string): string[] {
  const v = s?.[option];
  if (v === undefined) return [];
  return typeof v === 'string' ? v.split(/\s+/).filter((x) => x !== '') : v;
}

/** UCI booleans: '1', 'true', 'yes', 'on' (and the option's default when unset). */
export function bool(s: Section | undefined, option: string, fallback = false): boolean {
  const v = str(s, option);
  return v === undefined ? fallback : ['1', 'true', 'yes', 'on', 'enabled'].includes(v);
}

export type Change =
  | { op: 'set'; config: string; section: string; values: Record<string, string | string[]> }
  | { op: 'unset'; config: string; section: string; options: string[] }
  | { op: 'add'; config: string; type: string; name?: string; values: Record<string, string | string[]> }
  | { op: 'delete'; config: string; section: string }
  /** sections moved to positions 0, 1, 2…: list every section of the config to keep the rest in place */
  | { op: 'order'; config: string; sections: string[] };

/**
 * Set, or unset (undefined), options of one named section: adds the section
 * if it's missing, and deletes it when nothing would be left in it.
 */
export function sectionChanges(
  config: string,
  sections: Section[],
  name: string,
  options: Record<string, string | undefined>,
): Change[] {
  const s = sections.find((x) => x['.name'] === name);
  const values: Record<string, string> = {};
  const unset: string[] = [];
  for (const [option, value] of Object.entries(options)) {
    if (value === undefined) {
      if (s?.[option] !== undefined) unset.push(option);
    } else if (str(s, option) !== value) {
      values[option] = value;
    }
  }
  const changes: Change[] = [];
  if (Object.keys(values).length > 0) {
    changes.push(
      s === undefined ? { op: 'add', config, type: name, name, values } : { op: 'set', config, section: name, values },
    );
  }
  if (unset.length > 0) {
    const kept = Object.keys(s ?? {}).filter((k) => !k.startsWith('.') && !unset.includes(k));
    changes.push(
      kept.length === 0 && Object.keys(values).length === 0
        ? { op: 'delete', config, section: name }
        : { op: 'unset', config, section: name, options: unset },
    );
  }
  return changes;
}

/**
 * Stage changes after dropping everything this session already has staged.
 * rpcd applies all of a session's staged changes, and a rollback stages
 * again what it undid, so a save after one (the firewall's check failing)
 * would apply the undone change too, without that page's checks.
 */
export async function stage(changes: readonly Change[]): Promise<void> {
  const staged = await call('uci', 'changes', {}, z.object({ changes: z.record(z.string(), z.unknown()) }))
    .then((r) => Object.keys(r.changes))
    .catch((): string[] => []);
  const configs = [...new Set([...staged, ...changes.map((c) => c.config)])];
  await Promise.all(configs.map((config) => exec('uci', 'revert', { config }).catch(() => undefined)));
  for (const c of changes) {
    switch (c.op) {
      case 'set':
        await exec('uci', 'set', { config: c.config, section: c.section, values: c.values });
        break;
      case 'unset':
        // rpcd answers notFound when none of the options is set: already unset, which is the goal
        if (c.options.length > 0) {
          await exec('uci', 'delete', { config: c.config, section: c.section, options: c.options }).catch((err: unknown) => {
            if (!(err instanceof UbusError && err.code === UbusStatus.notFound)) throw err;
          });
        }
        break;
      case 'add':
        await exec('uci', 'add', {
          config: c.config,
          type: c.type,
          values: c.values,
          ...(c.name === undefined ? {} : { name: c.name }),
        });
        break;
      case 'delete':
        await exec('uci', 'delete', { config: c.config, section: c.section });
        break;
      case 'order':
        await exec('uci', 'order', { config: c.config, sections: c.sections });
        break;
    }
  }
}

/** Apply staged changes with rollback armed. False when nothing was staged. */
export async function applyWithRollback(timeoutSeconds: number): Promise<boolean> {
  try {
    await exec('uci', 'apply', { rollback: true, timeout: timeoutSeconds });
    return true;
  } catch (err) {
    if (err instanceof UbusError && err.code === UbusStatus.noData) return false;
    throw err;
  }
}

/** Apply staged changes with no rollback, as LuCI's "Apply unchecked" does. */
export async function applyUnchecked(): Promise<boolean> {
  try {
    await exec('uci', 'apply', { rollback: false });
    return true;
  } catch (err) {
    if (err instanceof UbusError && err.code === UbusStatus.noData) return false;
    throw err;
  }
}

/** Keep the applied changes (cancel the pending rollback). */
export function confirm(): Promise<void> {
  return exec('uci', 'confirm');
}

/** Undo the applied changes now rather than when the rollback timer runs out. */
export function rollback(): Promise<void> {
  return exec('uci', 'rollback');
}

const execResult = z.object({ code: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }).loose();

/**
 * Whether the firewall config as saved loads: `fw4 check` renders it and has
 * nft test it, changing nothing. nft's error when it doesn't ("log prefix is
 * too long"), undefined when it does.
 */
export async function firewallError(): Promise<string | undefined> {
  const res = await call('file', 'exec', { command: '/sbin/fw4', params: ['check'] }, execResult);
  if (res.code === 0) return undefined;
  const lines = `${res.stderr ?? ''}\n${res.stdout ?? ''}`.split('\n').map((l) => l.trim());
  const error = lines.find((l) => l.includes('Error:'))?.replace(/^.*?Error:\s*/, '');
  return error ?? lines.filter((l) => l !== '').at(-1) ?? 'no details';
}

/** How long rpcd keeps a firewall change's rollback armed while nft checks it. */
const FIREWALL_ROLLBACK_SECONDS = 60;

/** A firewall change nft wouldn't load: it was rolled back. */
export class FirewallRejectedError extends Error {
  readonly fault: string;

  constructor(fault: string) {
    super(`The firewall couldn’t load this (${fault}), so it was undone.`);
    this.name = 'FirewallRejectedError';
    this.fault = fault;
  }
}

/** What nft finds wrong with the firewall config; undefined when it loads, or when the check can't run. */
async function firewallFault(): Promise<string | undefined> {
  try {
    return await firewallError();
  } catch {
    return undefined;
  }
}

/**
 * The save every settings page makes: stage the changes and apply them at
 * once, as LuCI's "Apply unchecked" does: no timer that undoes a change the
 * browser can't confirm, so a new Wi-Fi name or password stays however long
 * devices take to rejoin. A firewall change is the exception: it's applied
 * with rollback armed, and undone at once (FirewallRejectedError) if nft
 * won't load it, rather than kept for the next reload or boot to fail on;
 * otherwise it's kept straight away.
 */
export async function applyChanges(changes: readonly Change[]): Promise<{ nothingChanged: boolean }> {
  // a firewall that already fails its check isn't this change's doing: then it's applied like the rest
  const checkFirewall = changes.some((c) => c.config === 'firewall') && (await firewallFault()) === undefined;
  await stage(changes);
  const applied = checkFirewall ? await applyWithRollback(FIREWALL_ROLLBACK_SECONDS) : await applyUnchecked();
  if (!applied) return { nothingChanged: true };
  if (checkFirewall) {
    const fault = await firewallFault();
    if (fault !== undefined) {
      await rollback();
      throw new FirewallRejectedError(fault);
    }
    await confirm();
  }
  return { nothingChanged: false };
}

/** Drop everything this session has staged. */
export async function revertAll(configs: readonly string[]): Promise<void> {
  await Promise.all(configs.map((config) => exec('uci', 'revert', { config })));
}
