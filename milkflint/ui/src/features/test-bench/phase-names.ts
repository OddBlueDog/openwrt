// Each kind of phase's name, for text (phases.ts adds its look).
import type { Phase, PhaseKind } from './api';

export const phaseNames: Record<PhaseKind, string> = {
  idle: 'Idle',
  wan_down: 'Download',
  wan_up: 'Upload',
  wan_both: 'Both ways',
  connect: 'Connect',
  d2d: 'Device to device',
  dns: 'DNS and pages',
  household: 'Busy household',
  cooldown: 'Settle',
};

export const phaseName = (p: Pick<Phase, 'kind' | 'label'>): string => p.label ?? phaseNames[p.kind];
