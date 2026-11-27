// The Plan card's last choices, kept in this browser's localStorage. Not kept:
// Rehearsal, the run name and the endpoint, which should start fresh each time.
// Each field is checked on its own, so a hand-edited or older value only resets
// that field, and never leaves a schedule the router would refuse.
import { z } from 'zod';
import { storedValue } from '../../lib/stored';
import type { Options } from './api';
import { MAX_CUSTOM_SITES, parseSites } from './pages';
import {
  type CustomPlan,
  defaultCustom,
  MAX_BUDGET_MB,
  MAX_PHASE_S,
  MIN_BUDGET_MB,
  MIN_PHASE_S,
  type PresetId,
  presets,
} from './plans';

export interface PlanChoices {
  preset: PresetId;
  custom: CustomPlan;
  latency: Options['latency'];
  budget_mb: number;
  custom_sites: string[];
}

export const defaultChoices: PlanChoices = {
  preset: 'quick',
  custom: defaultCustom,
  latency: 'uk',
  budget_mb: 0,
  custom_sites: [],
};

const flag = (d: boolean): z.ZodCatch<z.ZodBoolean> => z.boolean().catch(d);

const customSchema = z
  .object({
    idleS: z.number().int().min(0).max(MAX_PHASE_S).catch(defaultCustom.idleS),
    loadS: z.number().int().min(MIN_PHASE_S).max(MAX_PHASE_S).catch(defaultCustom.loadS),
    download: flag(defaultCustom.download),
    upload: flag(defaultCustom.upload),
    both: flag(defaultCustom.both),
    everyone: flag(defaultCustom.everyone),
    d2d: flag(defaultCustom.d2d),
    dns: flag(defaultCustom.dns),
    household: flag(defaultCustom.household),
  })
  .catch(() => ({ ...defaultCustom }));

const choicesSchema = z.object({
  preset: z
    .string()
    .refine((p): p is PresetId => presets.some((x) => x.id === p))
    .catch(defaultChoices.preset),
  custom: customSchema,
  latency: z.enum(['uk', 'eu', 'us']).catch(defaultChoices.latency),
  budget_mb: z
    .number()
    .int()
    .refine((n) => n === 0 || (n >= MIN_BUDGET_MB && n <= MAX_BUDGET_MB))
    .catch(0),
  custom_sites: z
    .array(z.unknown())
    .transform((l) => parseSites(l.filter((s): s is string => typeof s === 'string').join(' ')).sites.slice(0, MAX_CUSTOM_SITES))
    .catch([]),
});

export function parseChoices(raw: unknown): PlanChoices {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...defaultChoices, custom: { ...defaultCustom } };
  return choicesSchema.parse(raw);
}

export const planChoices = storedValue('milkflint.bench.plan', parseChoices, () => parseChoices(null));
