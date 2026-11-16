import { DownloadIcon } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/utils';
import { type Check, runChecks, type Thresholds } from './checks';
import { DnsReport } from './dns-report';
import { buildExport, exportName } from './export';
import { latencyRows } from './latency';
import { LatencyReport } from './latency-report';
import { PairMatrix } from './pair-matrix';
import { ResultsTable } from './results-table';
import { RunInfo } from './run-info';
import { reportRun, type RunData } from './run-data';
import { Timelines } from './timelines-report';
import { useThresholds } from './thresholds';
import { Verdict } from './verdict';

function ExportButton({
  data,
  checks,
  thresholds,
}: {
  data: RunData;
  checks: readonly Check[];
  thresholds: Thresholds;
}): ReactElement {
  const [error, setError] = useState<string>();
  const save = (): void => {
    try {
      const blob = new Blob([JSON.stringify(buildExport(data, checks, thresholds))], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportName(data);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="outline" onClick={save}>
        <DownloadIcon /> Download JSON
      </Button>
      {error !== undefined && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/**
 * A finished run's report, from its raw parts: the verdicts, latency idle
 * and under load, each phase, the run over time, device to device, DNS
 * and pages, and what the run was. A rehearsal's is how well the devices
 * kept time. `note` says where it came from (a file).
 */
export function RunReport({ data, note }: { data: RunData; note?: string | undefined }): ReactElement {
  const thresholds = useThresholds();
  const checks = useMemo(() => runChecks(data, thresholds), [data, thresholds]);
  const rows = useMemo(() => latencyRows(data), [data]);
  const run = reportRun(data);
  const { schedule, members } = data.meta;
  return (
    // each part a section of its own, a hairline between them
    <div className="flex flex-col gap-6 [&>section+section]:border-t [&>section+section]:pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <span className="max-w-prose min-w-0 flex-1 text-xs text-muted-foreground">
          {note ??
            'Everything below is worked out in this browser from what the devices and the router recorded; the file has all of it.'}
        </span>
        <ExportButton data={data} checks={checks} thresholds={thresholds} />
      </div>
      <Verdict checks={checks} />
      {!schedule.dry && (
        <>
          <LatencyReport rows={rows} members={members} thresholds={thresholds} />
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Phase by phase</h3>
            <ResultsTable data={data} run={run} schedule={schedule} members={members} />
          </section>
          <Timelines data={data} />
          <PairMatrix data={data} run={run} schedule={schedule} members={members} />
          <DnsReport data={data} run={run} schedule={schedule} members={members} />
        </>
      )}
      <RunInfo data={data} />
    </div>
  );
}
