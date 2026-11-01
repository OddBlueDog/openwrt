import { CrownIcon, MonitorSmartphoneIcon, WifiOffIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { handoff, kick, rename, startRun } from './api';
import { InviteCard } from './invite-card';
import type { BenchMember, MemberState } from './member';
import { type MemberActions, MemberCard } from './member-card';
import { PlanCard } from './plan-card';
import { RunCard } from './run-card';

export interface AdminControls {
  token: string;
  code: string;
  codeDisabled: boolean;
  onNewCode: () => Promise<void>;
  /** make this tab's member the coordinator again */
  onTakeOver: () => Promise<void>;
}

/** The bench as a member sees it: the run, the devices, and for the coordinator the invite and the plan. */
export function BenchView({ member, state, admin }: { member: BenchMember; state: MemberState; admin?: AdminControls }): ReactElement {
  const p = state.poll;
  const me = state.me;
  const sid = member.session;
  const coordinatorId = p?.bench.coordinator ?? undefined;
  const isCoordinator = me !== undefined && coordinatorId === me;
  const members = p?.members ?? [];
  const coordinatorName = members.find((m) => m.id === coordinatorId)?.name;
  const runOn = p?.run?.state === 'scheduled' || p?.run?.state === 'running' || p?.run?.state === 'stopping';
  const token = admin?.token ?? p?.bench.token ?? undefined;
  const code = admin?.code ?? p?.bench.code ?? undefined;
  const schedule = state.schedule;

  const actionsFor = (id: string): MemberActions => {
    if (sid === undefined) return {};
    const a: MemberActions = {};
    if (id === me || isCoordinator) {
      a.rename = async (name) => {
        await rename(sid, name, id === me ? undefined : id);
      };
    }
    if (isCoordinator && id !== me) {
      a.makeCoordinator = () => handoff(sid, id);
      a.remove = () => kick(sid, id);
    }
    return a;
  };

  return (
    <div className="flex flex-col gap-4">
      {state.pollError !== undefined && (
        <Alert variant="warning">
          <WifiOffIcon />
          <AlertTitle>Can&apos;t reach the router</AlertTitle>
          <AlertDescription>{state.pollError}. Trying again every second; a run this device is in stops its part after a few seconds.</AlertDescription>
        </Alert>
      )}
      {state.run !== undefined && <RunCard member={member} state={state} />}
      <div className={isCoordinator && token !== undefined && code !== undefined ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]' : 'flex flex-col gap-4'}>
        <Card>
          <CardHeading
            icon={MonitorSmartphoneIcon}
            title={`Devices · ${String(members.length)}`}
            description="Every device on the bench, and how the router sees it connected"
          />
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No devices yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {members.map((m) => {
                  const phase = runOn && m.phase !== undefined && m.phase !== null && m.phase >= 0 ? schedule?.phases[m.phase] : undefined;
                  return (
                    <MemberCard
                      key={m.id}
                      m={m}
                      me={m.id === me}
                      coordinator={m.id === coordinatorId}
                      phaseLabel={phase === undefined ? undefined : (phase.label ?? undefined)}
                      actions={actionsFor(m.id)}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        {isCoordinator && token !== undefined && code !== undefined && (
          <InviteCard token={token} code={code} codeDisabled={admin?.codeDisabled ?? p?.bench.code_disabled === true} onNewCode={admin?.onNewCode} />
        )}
      </div>
      {isCoordinator && sid !== undefined && (
        <PlanCard
          members={members}
          shaper={p?.bench.shaper}
          busy={runOn}
          onStart={async (s) => {
            await startRun(sid, s);
          }}
        />
      )}
      {!isCoordinator && p !== undefined && (
        <Alert variant="info">
          <CrownIcon />
          <AlertDescription>
            {coordinatorName === undefined
              ? 'Nobody coordinates this bench right now.'
              : `${coordinatorName} picks the plan and starts runs.`}{' '}
            Any device can stop a run.
          </AlertDescription>
          {admin !== undefined && (
            <Button type="button" size="sm" variant="outline" className="mt-2 w-fit" onClick={() => void admin.onTakeOver()}>
              <CrownIcon /> Coordinate from here
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
}
