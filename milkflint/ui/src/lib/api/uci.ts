// OpenWrt's configuration (UCI) through rpcd. Changes are staged in this
// session's own change set, then applied together with rollback armed: the
// router undoes them unless the browser confirms it can still reach it.
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

/** Stage changes after dropping anything already staged for those configs. */
export async function stage(changes: readonly Change[]): Promise<void> {
  const configs = [...new Set(changes.map((c) => c.config))];
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

/**
 * Apply staged changes with no rollback. Only for changes the browser can't
 * confirm, like moving the router to a new LAN address.
 */
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

/** Drop everything this session has staged. */
export async function revertAll(configs: readonly string[]): Promise<void> {
  await Promise.all(configs.map((config) => exec('uci', 'revert', { config })));
}
