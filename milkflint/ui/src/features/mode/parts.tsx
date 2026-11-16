// The Operating mode page's pieces: the two modes with their diagram (the
// internet, the routers and your devices, MilkFlint marked where it sits),
// the lists of what a switch changes, and the bridge fast path's switch.
import type { LucideIcon } from 'lucide-react';
import { ArrowRightIcon, GlobeIcon, LaptopIcon, RadioTowerIcon, RouterIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Field } from '@/components/field';
import { Logo } from '@/components/layout/sidebar';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { RouterMode } from '@/lib/router-mode';
import { cn } from '@/lib/utils';
import { type ChoiceOption, ChoiceCards } from '@/components/page-kit';
import { explain } from '@/components/explain';

interface Step {
  icon?: LucideIcon;
  label: string;
  self?: boolean;
}

/** Internet → … → your devices, with MilkFlint where it sits in this mode. */
function Path({ steps }: { steps: readonly Step[] }): ReactElement {
  return (
    <span className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRightIcon className="size-3.5 text-muted-foreground" />}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs whitespace-nowrap',
              s.self === true ? 'border-primary/40 bg-primary/5 font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {s.icon !== undefined ? <s.icon className="size-3.5" /> : <Logo className="size-3.5" />}
            {s.label}
          </span>
        </span>
      ))}
    </span>
  );
}

const modes: readonly { mode: RouterMode; icon: LucideIcon; title: string; text: string; path: readonly Step[] }[] = [
  {
    mode: 'router',
    icon: RouterIcon,
    title: 'Router',
    text: 'MilkFlint connects to the internet and runs your network: addresses, firewall, Smart Queue, DNS and guest Wi-Fi.',
    path: [
      { icon: GlobeIcon, label: 'Internet' },
      { label: 'MilkFlint', self: true },
      { icon: LaptopIcon, label: 'Your devices' },
    ],
  },
  {
    mode: 'ap',
    icon: RadioTowerIcon,
    title: 'Access point',
    text: 'Another router runs your network. MilkFlint joins it: its Wi-Fi and every port become part of that network.',
    path: [
      { icon: GlobeIcon, label: 'Internet' },
      { icon: RouterIcon, label: 'Main router' },
      { label: 'MilkFlint', self: true },
      { icon: LaptopIcon, label: 'Your devices' },
    ],
  },
];

/** The two modes as cards to pick from, each with its diagram; nothing changes until the switch button. */
export function ModeChoice({
  value,
  current,
  disabled,
  onChange,
}: {
  value: RouterMode;
  current: RouterMode;
  disabled: boolean;
  onChange: (m: RouterMode) => void;
}): ReactElement {
  const options: ChoiceOption<RouterMode>[] = modes.map((m) => ({
    value: m.mode,
    label: m.title,
    icon: m.icon,
    hint: m.text,
    badge:
      m.mode === current ? (
        <Badge variant="secondary" className="h-5 px-2 font-normal">
          Now
        </Badge>
      ) : undefined,
    extra: <Path steps={m.path} />,
  }));
  return (
    <ChoiceCards
      label="Operating mode"
      columns={2}
      size="lg"
      value={value}
      options={options}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** One thing a switch changes, with its icon. */
export function ChangeItem({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

/** fw4's bridge fast path (flow_offloading_bridge), as a settings row. */
export function BridgeField({
  checked,
  available,
  disabled,
  onChange,
}: {
  checked: boolean;
  available: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <Field
      id="bridge-offload"
      label="Faster bridging"
      {...(available
        ? explain(
            'Connections between devices on this network take a shorter way through MilkFlint. Wi-Fi to wired, or to your main router: meant to save processor time. It doesn’t change what’s allowed through: only connections the bridge passes anyway take it, and every frame is checked. Router mode turns it off.',
            ['firewall.@defaults[0].flow_offloading_bridge'],
          )
        : { status: 'This image has no bridge fast path.' })}
    >
      <span className="flex items-center gap-3">
        <Switch id="bridge-offload" checked={checked && available} disabled={disabled || !available} onCheckedChange={onChange} />
        <Badge variant="outline" className="font-normal">
          Experimental
        </Badge>
      </span>
    </Field>
  );
}
