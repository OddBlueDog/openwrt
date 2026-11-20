// The Scheduled tasks' first-boot step, run for real with a pretend crontab
// and config: an older MilkFlint's tasks (milkflint.schedule sections, and
// the marked block its init script kept in root's crontab for a runner)
// become plain cron lines once, as the page and LuCI write them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
  new URL('../../../package/milkflint/milkflint-ui/files/features/schedules/uci-defaults', import.meta.url),
);
const BEGIN = '# milkflint-schedules begin (managed by the web interface)';
const END = '# milkflint-schedules end';
const RUN = '/usr/libexec/milkflint/schedule-run';

interface Section {
  action?: string;
  time?: string;
  days?: string;
  enabled?: string;
}

interface Result {
  /** undefined: no crontab */
  crontab: string | undefined;
  /** the sections deleted and committed, as uci was called */
  uci: string[];
  /** cron's init script, as it was called */
  cron: string[];
}

/** The step with these sections in the config and this crontab (none if undefined). */
function migrate(sections: Section[], crontab?: string): Result {
  const root = mkdtempSync(join(tmpdir(), 'schedules-'));
  try {
    const tabs = join(root, 'crontabs');
    const tab = join(tabs, 'root');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    if (crontab !== undefined) {
      mkdirSync(tabs);
      writeFileSync(tab, crontab);
    }
    for (const name of ['uci', 'cron']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "$*" >> ${join(root, `${name}.log`)}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    // /lib/functions.sh's config functions, over the sections given
    const config = sections.flatMap((t, i) => Object.entries(t).map(([k, v]) => `CFG_s${String(i)}_${k}='${String(v)}'`));
    const functions = `config_load() { :; }
config_foreach() { for s in ${sections.map((_, i) => `s${String(i)}`).join(' ')}; do "$1" "$s"; done; }
config_get() { eval "$1=\\\${CFG_$2_$3:-}"; }
config_get_bool() { eval "v=\\\${CFG_$2_$3:-$4}"; case "$v" in 1|on|true|yes) eval "$1=1" ;; *) eval "$1=0" ;; esac; }
${config.join('\n')}`;
    const body = readFileSync(script, 'utf8')
      .replace('. /lib/functions.sh', functions)
      .replaceAll('/etc/crontabs/root', tab)
      .replaceAll('/etc/crontabs', tabs)
      .replaceAll('/etc/init.d/cron', join(bin, 'cron'));
    writeFileSync(join(root, 'run.sh'), body);
    execFileSync('/bin/sh', [join(root, 'run.sh')], {
      env: { PATH: `${bin}:/usr/bin:/bin` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = (name: string): string[] => {
      const p = join(root, `${name}.log`);
      return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n') : [];
    };
    return { crontab: existsSync(tab) ? readFileSync(tab, 'utf8') : undefined, uci: log('uci'), cron: log('cron') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const block = (...lines: string[]): string => [BEGIN, ...lines, END].join('\n');

test('nothing to move: nothing changes, no crontab made, uci and cron left alone', () => {
  assert.deepEqual(migrate([]), { crontab: undefined, uci: [], cron: [] });
  const mine = '0 3 * * * /root/backup.sh\n';
  assert.deepEqual(migrate([], mine), { crontab: mine, uci: [], cron: [] });
});

test('each section a plain line: minute and hour as cron reads them, its days as a list, the command itself', () => {
  const r = migrate([
    { action: 'reboot', time: '08:05' },
    { action: 'wifi_off', time: '23:30', days: '1 2 3 4 5' },
    { action: 'wifi_on', time: '00:00', days: '0' },
  ]);
  assert.equal(r.crontab, '5 8 * * * /sbin/reboot\n30 23 * * 1,2,3,4,5 /sbin/wifi down\n0 0 * * 0 /sbin/wifi up\n');
  assert.deepEqual(r.uci, ['-q delete milkflint.s0', '-q delete milkflint.s1', '-q delete milkflint.s2', 'commit milkflint']);
  assert.deepEqual(r.cron, ['enable']);
});

test('a task switched off is a line commented out; anything else odd is left out, its section goes too', () => {
  const r = migrate([
    { action: 'reboot', time: '04:00', enabled: '0' },
    { action: 'halt', time: '04:00' },
    { action: 'reboot;id', time: '04:00' },
    { action: 'reboot', time: '24:00' },
    { action: 'reboot', time: '4:00' },
    { action: 'wifi_on', time: '07:00', days: '1;reboot' },
  ]);
  assert.equal(r.crontab, '# 0 4 * * * /sbin/reboot\n0 7 * * * /sbin/wifi up\n');
  assert.equal(r.uci.length, 7);
});

test('the old block goes, the user’s own lines stay where they were, the tasks after them', () => {
  const mine = '0 3 * * * /root/backup.sh';
  const after = '# a note\n*/5 * * * * /root/check.sh';
  const r = migrate([{ action: 'wifi_off', time: '22:30' }], `${mine}\n${block(`30 22 * * * ${RUN} wifi_off`)}\n${after}\n`);
  assert.equal(r.crontab, `${mine}\n${after}\n30 22 * * * /sbin/wifi down\n`);
});

test('banIP’s block is banIP’s: left as it is', () => {
  const banip =
    '# milkflint-banip begin (managed by the web interface)\n34 3,15 * * * /usr/libexec/milkflint/banip-action reload\n# milkflint-banip end\n';
  const r = migrate([{ action: 'reboot', time: '04:00' }], `${block(`0 4 * * * ${RUN} reboot`)}\n${banip}`);
  assert.equal(r.crontab, `${banip}0 4 * * * /sbin/reboot\n`);
});

test('a block without its sections (taken out by hand): its lines with the runner’s commands', () => {
  const r = migrate([], `${block(`5 4 * * 1,2 ${RUN} reboot`, `0 23 * * * ${RUN} wifi_off`, `0 1 * * * ${RUN} halt`)}\n`);
  assert.equal(r.crontab, '5 4 * * 1,2 /sbin/reboot\n0 23 * * * /sbin/wifi down\n');
  assert.deepEqual(r.uci, []);
  // a block with nothing left in it just goes
  assert.equal(migrate([], `0 3 * * * x\n${block()}\n`).crontab, '0 3 * * * x\n');
});

test('run again, it changes nothing', () => {
  const once = migrate([{ action: 'reboot', time: '04:00' }], `0 3 * * * x\n${block(`0 4 * * * ${RUN} reboot`)}\n`).crontab;
  assert.deepEqual(migrate([], once), { crontab: once, uci: [], cron: [] });
});
