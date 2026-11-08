// The Scheduled Tasks page's router side run for real, with a pretend crontab
// and config: the marked block it keeps in root's crontab, and the task runner.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../../package/milkflint/milkflint-ui/files/features/schedules/', import.meta.url));
const BEGIN = '# milkflint-schedules begin (managed by the web interface)';
const END = '# milkflint-schedules end';
const RUN = '/usr/libexec/milkflint/schedule-run';

interface Task {
  action?: string;
  time?: string;
  days?: string;
  enabled?: string;
}

/** The init script's start with these tasks: the crontab it leaves, and whether cron was restarted. */
function start(tasks: Task[], crontab?: string): { crontab: string; restarted: boolean } {
  const root = mkdtempSync(join(tmpdir(), 'schedules-'));
  try {
    const tab = join(root, 'crontab');
    const log = join(root, 'cron.log');
    if (crontab !== undefined) writeFileSync(tab, crontab);
    writeFileSync(join(root, 'cron'), `#!/bin/sh\necho "$1" >> ${log}\n`);
    chmodSync(join(root, 'cron'), 0o755);
    const init = readFileSync(join(dir, 'init'), 'utf8')
      .replace('/etc/crontabs/root', tab)
      .replaceAll('/etc/init.d/cron', join(root, 'cron'));
    // rc.common's config functions, over the tasks given
    const config = tasks
      .flatMap((t, i) => Object.entries(t).map(([k, v]) => `CFG_t${String(i)}_${k}='${String(v)}'`))
      .join('\n');
    const harness = `config_load() { :; }
config_foreach() { for s in ${tasks.map((_, i) => `t${String(i)}`).join(' ')}; do "$1" "$s"; done; }
config_get() { eval "$1=\\\${CFG_$2_$3:-}"; }
config_get_bool() { eval "v=\\\${CFG_$2_$3:-$4}"; case "$v" in 1|on|true|yes) eval "$1=1" ;; *) eval "$1=0" ;; esac; }
${config}
${init}
start_service
`;
    writeFileSync(join(root, 'harness.sh'), harness);
    execFileSync('/bin/sh', [join(root, 'harness.sh')], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { crontab: readFileSync(tab, 'utf8'), restarted: existsSync(log) && readFileSync(log, 'utf8').includes('restart') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const line = (time: string, days: string, action: string): string => `${time} * * ${days} ${RUN} ${action}`;
const block = (...lines: string[]): string => [BEGIN, ...lines, END, ''].join('\n');

test('a task: minute and hour without leading zeroes, as cron reads them', () => {
  assert.equal(start([{ action: 'reboot', time: '08:05' }]).crontab, block(line('5 8', '*', 'reboot')));
  assert.equal(start([{ action: 'wifi_off', time: '00:00' }]).crontab, block(line('0 0', '*', 'wifi_off')));
  assert.equal(start([{ action: 'wifi_on', time: '23:59' }]).crontab, block(line('59 23', '*', 'wifi_on')));
  assert.equal(start([{ action: 'wifi_on', time: '10:30' }]).crontab, block(line('30 10', '*', 'wifi_on')));
});

test('its days as cron’s list; anything else means every day', () => {
  assert.equal(start([{ action: 'reboot', time: '04:00', days: '1 3 5' }]).crontab, block(line('0 4', '1,3,5', 'reboot')));
  assert.equal(start([{ action: 'reboot', time: '04:00', days: '0' }]).crontab, block(line('0 4', '0', 'reboot')));
  for (const days of ['7', 'mon', '1;reboot', '*']) {
    assert.equal(start([{ action: 'reboot', time: '04:00', days }]).crontab, block(line('0 4', '*', 'reboot')), days);
  }
});

test('anything but a real time, or a known action, is left out', () => {
  for (const time of ['', '8:05', '08:5', '24:00', '25:61', '12:60', '08-05', 'x:y', '08:05:00', '* *']) {
    assert.equal(start([{ action: 'reboot', time }]).crontab, '', time);
  }
  for (const action of ['', 'halt', 'wifi_down', 'reboot;id', '../x']) {
    assert.equal(start([{ action, time: '04:00' }]).crontab, '', action);
  }
});

test('turned off, it’s left out', () => {
  assert.equal(start([{ action: 'reboot', time: '04:00', enabled: '0' }]).crontab, '');
  assert.equal(start([{ action: 'reboot', time: '04:00', enabled: '1' }]).crontab, block(line('0 4', '*', 'reboot')));
});

test('the user’s own lines outside the block stay, before and after it', () => {
  const mine = '0 3 * * * /root/backup.sh\n';
  const after = '# a note\n*/5 * * * * /root/check.sh\n';
  const old = `${mine}${block(line('0 1', '*', 'reboot'))}${after}`;
  const r = start([{ action: 'wifi_off', time: '22:30' }], old);
  assert.equal(r.crontab, `${mine}${after}${block(line('30 22', '*', 'wifi_off'))}`);
  assert.ok(!r.crontab.includes('0 1 * * *'));
});

test('no tasks left: the block goes, the rest stays', () => {
  const mine = '0 3 * * * /root/backup.sh\n';
  assert.equal(start([], `${mine}${block(line('0 1', '*', 'reboot'))}`).crontab, mine);
});

test('several tasks, one block, in order', () => {
  const r = start([{ action: 'wifi_off', time: '23:00' }, { action: 'wifi_on', time: '07:00', days: '1 2' }]);
  assert.equal(r.crontab, block(line('0 23', '*', 'wifi_off'), line('0 7', '1,2', 'wifi_on')));
});

test('cron is restarted when the crontab changed, and only then', () => {
  const tab = block(line('0 4', '*', 'reboot'));
  assert.equal(start([{ action: 'reboot', time: '04:00' }]).restarted, true);
  assert.equal(start([{ action: 'reboot', time: '04:00' }], tab).restarted, false);
  assert.equal(start([{ action: 'reboot', time: '05:00' }], tab).restarted, true);
  assert.equal(start([]).restarted, false);
});

test('running twice gives the same crontab', () => {
  const once = start([{ action: 'reboot', time: '04:00' }], '0 3 * * * /root/x\n').crontab;
  assert.equal(start([{ action: 'reboot', time: '04:00' }], once).crontab, once);
});

test('the runner does what the task says, and nothing for anything else', () => {
  const root = mkdtempSync(join(tmpdir(), 'schedule-run-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'log');
    for (const name of ['reboot', 'wifi', 'logger']) {
      writeFileSync(join(bin, name), `#!/bin/sh\n[ "${name}" = logger ] || echo "${name} $*" >> ${log}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const run = (arg: string): { status: number | null; log: string } => {
      writeFileSync(log, '');
      const r = spawnSync('/bin/sh', [join(dir, 'bin/schedule-run'), arg], { env: { PATH: `${bin}:/usr/bin:/bin` } });
      return { status: r.status, log: readFileSync(log, 'utf8') };
    };
    assert.deepEqual(run('reboot'), { status: 0, log: 'reboot \n' });
    assert.deepEqual(run('wifi_off'), { status: 0, log: 'wifi down\n' });
    assert.deepEqual(run('wifi_on'), { status: 0, log: 'wifi up\n' });
    assert.deepEqual(run('halt'), { status: 1, log: '' });
    assert.deepEqual(run(''), { status: 1, log: '' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
