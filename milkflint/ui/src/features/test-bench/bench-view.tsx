import { CrownIcon, WifiOffIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { handoff, kick, rename, startRun } from './api';
import { useBenchWrite } from './queries';
import { Arrowed } from '@/components/dir';
import { InviteCard } from './invite-card';
import type { BenchMember, MemberState } from './member';
import { type MemberActions, type MemberEntry, MemberList } from './member-card';
import { PlanCard } from './plan-card';
import { phaseStyle } from './phases';
import { RunCard } from './run-card';
import { devicesStatus, namesText, runOn as isRunOn, runStatus } from './summary';

export interface AdminControls {
  token: string;
  code: string;
  codeDisabled: boolean;
  onNewCode: () => Promise<void>;
  /** make this tab's member the coordinator again */
  onTakeOver: () => Promise<void>;
}

/** One part of the answer: what it is, its state as a status word, a line, and an action. */
function Cell({
  title,
  status,
  children,
  action,
}: {
  title: string;
  status: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex min-h-6 flex-wrap items-center gap-2">{status}</div>
      <p className="text-sm text-foreground">{children}</p>
      {action}
    </div>
  );
}

/** The bench now, on top: who has joined, where a run is, and who runs the bench. */
function BenchAnswer({
  state,
  isCoordinator,
  coordinatorName,
  admin,
}: {
  state: MemberState;
  isCoordinator: boolean;
  coordinatorName: string | undefined;
  admin: AdminControls | undefined;
}): ReactElement {
  const p = state.poll;
  const members = p?.members ?? [];
  const devices = devicesStatus(members);
  const run = p?.run ?? undefined;
  const status = runStatus(run);
  const on = isRunOn(run);
  const schedule = state.schedule;
  const phase =
    on && state.run !== undefined && state.run.id === run?.id && schedule !== undefined && state.phase >= 0
      ? schedule.phases[state.phase]
      : undefined;
  // the run card below has this run's report; otherwise it's under Past runs
  const shown = state.run !== undefined && state.run.id === run?.id;
  const name = shown ? schedule?.name : undefined;
  const runText = !on ? (
    run?.state === 'done' || run?.state === 'collecting' ? (
      `${name ?? 'The last run'}: its report is ${shown ? 'below' : 'under Past runs'}.`
    ) : isCoordinator ? (
      'Pick a plan below and press Start. Nothing runs until then.'
    ) : (
      'Nothing runs until the coordinator presses Start.'
    )
  ) : phase !== undefined ? (
    <>
      {name ?? 'The run'}: <Arrowed text={phase.label ?? phaseStyle[phase.kind].name} /> now. Any device can stop it.
    </>
  ) : (
    `${name ?? 'The run'}. Any device can stop it.`
  );
  return (
    <Card className="gap-0 py-0">
      <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <Cell title="Devices" status={<Badge variant={devices.tone}>{devices.text}</Badge>}>
          {members.length === 0
            ? isCoordinator
              ? 'Add your other devices with the QR code or the code.'
              : 'No devices yet.'
            : `${namesText(members.map((m) => m.name))} ${members.length === 1 ? 'has' : 'have'} joined.`}
        </Cell>
        <Cell title="Run" status={<Badge variant={status.tone}>{status.text}</Badge>}>
          {runText}
        </Cell>
        <Cell
          title="Coordinator"
          status={
            coordinatorName === undefined ? (
              <Badge variant="warning">Nobody</Badge>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <CrownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                {isCoordinator ? `You (${coordinatorName})` : coordinatorName}
              </span>
            )
          }
          action={
            !isCoordinator && admin !== undefined ? (
              <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => void admin.onTakeOver()}>
                <CrownIcon /> Coordinate from here
              </Button>
            ) : undefined
          }
        >
          {coordinatorName === undefined ? 'Nobody picks the plan or starts runs right now.' : 'Picks the plan and starts runs.'}{' '}
          Any device can stop a run.
        </Cell>
      </div>
    </Card>
  );
}

/** The bench as a member sees it: what's true now, the run, the devices, and for the coordinator the invite and the plan. */
export function BenchView({
  member,
  state,
  admin,
}: {
  member: BenchMember;
  state: MemberState;
  admin?: AdminControls;
}): ReactElement {
  const p = state.poll;
  const me = state.me;
  const sid = member.session;
  // a member's writes, with its own session: the bench's reads are asked again once each went through
  const write = useBenchWrite();
  const coordinatorId = p?.bench.coordinator ?? undefined;
  const isCoordinator = me !== undefined && coordinatorId === me;
  const members = p?.members ?? [];
  const coordinatorName = members.find((m) => m.id === coordinatorId)?.name;
  const runOn = isRunOn(p?.run);
  const token = admin?.token ?? p?.bench.token ?? undefined;
  const code = admin?.code ?? p?.bench.code ?? undefined;
  const schedule = state.schedule;
  const inviting = isCoordinator && token !== undefined && code !== undefined;

  const actionsFor = (id: string): MemberActions => {
    if (sid === undefined) return {};
    const a: MemberActions = {};
    if (id === me || isCoordinator) {
      a.rename = async (name) => {
        await write.mutateAsync(() => rename(sid, name, id === me ? undefined : id));
      };
    }
    if (isCoordinator && id !== me) {
      a.makeCoordinator = async () => {
        await write.mutateAsync(() => handoff(sid, id));
      };
      a.remove = async () => {
        await write.mutateAsync(() => kick(sid, id));
      };
    }
    return a;
  };
  const entries: MemberEntry[] = members.map((m) => {
    const phase = runOn && m.phase !== undefined && m.phase !== null && m.phase >= 0 ? schedule?.phases[m.phase] : undefined;
    return {
      m,
      me: m.id === me,
      coordinator: m.id === coordinatorId,
      phaseLabel: phase === undefined ? undefined : (phase.label ?? undefined),
      actions: actionsFor(m.id),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      {state.pollError !== undefined && (
        <Alert variant="warning">
          <WifiOffIcon />
          <AlertTitle>Can&apos;t reach the router</AlertTitle>
          <AlertDescription>
            {state.pollError}. Trying again every second; a run this device is in stops its part after a few seconds.
          </AlertDescription>
        </Alert>
      )}
      {p !== undefined && (
        <BenchAnswer state={state} isCoordinator={isCoordinator} coordinatorName={coordinatorName} admin={admin} />
      )}
      {state.run !== undefined && <RunCard member={member} state={state} />}
      <div className={inviting ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'flex flex-col gap-4'}>
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeading
            title={`Devices · ${String(members.length)}`}
            description="Every device on the bench, and how the router sees it connected"
          />
          <div className="mt-4">
            {members.length === 0 ? (
              <p className="border-t px-5 py-4 text-sm text-muted-foreground">
                No devices yet
                {inviting ? ': scan the QR code with another device, or type the code on the router’s sign-in page.' : '.'}
              </p>
            ) : (
              <MemberList entries={entries} />
            )}
          </div>
        </Card>
        {inviting && (
          <InviteCard
            token={token}
            code={code}
            codeDisabled={admin?.codeDisabled ?? p?.bench.code_disabled === true}
            onNewCode={admin?.onNewCode}
          />
        )}
      </div>
      {isCoordinator && sid !== undefined && (
        <PlanCard
          members={members}
          shaper={p?.bench.shaper}
          busy={runOn}
          onStart={async (s) => {
            await write.mutateAsync(() => startRun(sid, s));
          }}
        />
      )}
    </div>
  );
}
