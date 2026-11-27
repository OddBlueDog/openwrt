// The form of the sheet that adds or edits a group of devices or a single
// device (./person-sheet.tsx): what it starts from and its checks.
import { z } from 'zod';
import type { Entry } from './view';
import { type Window, windowError, windowOfRule } from './model';

export type When = 'times' | 'always' | 'never';

const sheetFields = z.object({
  name: z.string(),
  devices: z.array(z.string()),
  when: z.custom<When>(),
  windows: z.array(z.custom<Window>()),
  safeSearch: z.boolean(),
  guest: z.boolean(),
  /** older rules taken over: deleted on save */
  takeOver: z.array(z.string()),
  manual: z.string(),
});

export type SheetForm = z.infer<typeof sheetFields>;

/** Every field of the form, by name. */
export const sheetFieldNames = sheetFields.keyof().options;

/** The checks: a group needs a name, every entry a device, set times at least one time, each of them whole. */
export function sheetFormSchema(single: boolean): z.ZodType<SheetForm, SheetForm> {
  return sheetFields.superRefine((f, ctx) => {
    const nameError =
      !single && f.name.trim() === ''
        ? 'A name for the group, like Sam or Games consoles.'
        : f.name.length > 32
          ? 'At most 32 characters.'
          : undefined;
    if (nameError !== undefined) ctx.addIssue({ code: 'custom', path: ['name'], message: nameError });
    if (f.devices.length === 0) ctx.addIssue({ code: 'custom', path: ['devices'], message: 'Pick at least one device.' });
    if (f.when === 'times') {
      if (f.windows.length === 0)
        ctx.addIssue({ code: 'custom', path: ['windows'], message: 'Add a time, or choose Always or Only when paused.' });
      f.windows.forEach((w, i) => {
        const e = windowError(w);
        if (e !== undefined) ctx.addIssue({ code: 'custom', path: ['windows', i], message: e });
      });
    }
  });
}

/** What the sheet starts from: an entry's group, a device an older rule covers, or someone new. */
export function initialForm(entry: Entry | undefined, kind: 'person' | 'device', blocking: boolean): SheetForm {
  if (entry?.person !== undefined) {
    const p = entry.person;
    const own = entry.own;
    return {
      name: p.name ?? '',
      devices: [...p.devices],
      when: own?.always === true ? 'always' : (own?.windows.length ?? 0) > 0 || kind === 'person' ? 'times' : 'never',
      windows: own?.windows.map((w) => ({ ...w, days: [...w.days] })) ?? [],
      safeSearch: p.safeSearch,
      guest: p.guest,
      takeOver: [],
      manual: '',
    };
  }
  if (entry !== undefined) {
    // a device only an older rule covers: its times, as Device control writes them
    const windows = entry.older.flatMap((r) => {
      const w = windowOfRule(r);
      return w === undefined ? [] : [w];
    });
    const always = entry.older.some((r) => r.start === undefined && r.stop === undefined && r.days === undefined);
    return {
      name: entry.macs.length > 1 ? (entry.older[0]?.name ?? '') : '',
      devices: [...entry.macs],
      when: always ? 'always' : 'times',
      windows,
      safeSearch: false,
      guest: false,
      takeOver: entry.older.map((r) => r.section),
      manual: '',
    };
  }
  return {
    name: '',
    devices: [],
    // blocking (the Firewall page's Block a device) starts on always; anything else on set times, as a group does
    when: kind === 'device' && blocking ? 'always' : 'times',
    windows: [],
    safeSearch: false,
    guest: false,
    takeOver: [],
    manual: '',
  };
}
