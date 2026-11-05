// Whether downloads get back the DSCP their connection sends with: conntrack
// keeps it and the download's CAKE writes it where it would wash
// (milkflint.cake.dscp_restore, features/tuning/bin/cake-dscp). sqm-scripts'
// download CAKE needs two things for it: its wash (squash_dscp, on unless LuCI
// turned it off), and with layer_cake tins on the download (squash_ingress off:
// by default it ignores DSCP there and has one tin).

export type SqmDscpOption = 'squash_dscp' | 'squash_ingress';

export interface SqmDscpOptions {
  set: Partial<Record<SqmDscpOption, string>>;
  /** to unset, where they're set */
  unset: SqmDscpOption[];
}

/** sqm's options for it. Going from on to off takes back only what on set; with it off all along, nothing is touched. */
export function sqmDscpOptions(restore: boolean, prioritise: boolean, wasRestore: boolean): SqmDscpOptions {
  if (restore) {
    return prioritise ? { set: { squash_ingress: '0' }, unset: ['squash_dscp'] } : { set: {}, unset: ['squash_dscp', 'squash_ingress'] };
  }
  return { set: {}, unset: wasRestore ? ['squash_ingress'] : [] };
}
