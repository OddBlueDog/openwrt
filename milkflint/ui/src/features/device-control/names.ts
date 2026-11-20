// Device control's names on the router, with no imports, so the Firewall
// page can tell its sections apart without pulling in the rest. A person is
// a milkflint `person` section devctl_<4 letters or digits>; their rules are
// devctl_<id>_always and devctl_<id>_w<n> (an overnight window's morning
// _am, its Guest Wi-Fi rules _guest…); the sections every person shares are
// the two sets, the pause rule and the include that fills the sets.
export const PREFIX = 'devctl_';
export const PAUSED_SET = 'devctl_paused';
export const EXTRA_SET = 'devctl_extra';
export const PAUSE_RULE = 'devctl_pause';
export const RESTORE_INCLUDE = 'devctl_restore';
export const RESTORE_PATH = '/usr/libexec/milkflint/device-control-restore';
export const GLOBAL_SECTIONS = [PAUSED_SET, EXTRA_SET, PAUSE_RULE, RESTORE_INCLUDE] as const;

const PERSON_ID = /^devctl_[a-z0-9]{4}$/;
const RULE_NAME = /^(devctl_[a-z0-9]{4})_(always|w([0-9]{1,2})(?:_(guest[23]?))?(_am)?)$/;

export function isPersonId(id: string): boolean {
  return PERSON_ID.test(id);
}

/** What a section of the firewall config is to Device control, by its name. */
export type DevctlPart =
  | { kind: 'global' }
  | { kind: 'always'; person: string }
  | { kind: 'window'; person: string; n: number; guest: string | undefined; morning: boolean };

export function devctlPart(section: string): DevctlPart | undefined {
  if ((GLOBAL_SECTIONS as readonly string[]).includes(section)) return { kind: 'global' };
  const m = RULE_NAME.exec(section);
  if (m === null) return undefined;
  const person = m[1] ?? '';
  if (m[2] === 'always') return { kind: 'always', person };
  return { kind: 'window', person, n: Number(m[3]), guest: m[4], morning: m[5] !== undefined };
}
