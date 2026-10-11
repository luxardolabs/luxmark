// Locks the prod deploy (`make prod-sync` / `prod-deploy`) against fakes of ssh, docker and curl.
//
// The node trusts only the jump host's key, so every remote step crosses two ssh hops, and each hop's
// shell would re-parse a command line (`a; b` once ran `b` on the jump host). So the contract is:
// nothing but `sh -s` on the ssh command line, the real work as a script on stdin. prod-deploy must
// refuse a version that was never published, pin the node to it, and fail unless the live site
// reports it afterwards.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(root, 'VERSION'), 'utf8').trim();

// ssh: logs its argv, saves each stdin script. docker: `manifest inspect` per PUBLISHED.
// curl: serves a version.json reporting LIVE.
const FAKES = {
  ssh: `#!/bin/sh
n=$(ls "$LOGDIR" | grep -c '^stdin') ; echo "ssh $*" >> "$LOGDIR/calls"
cat > "$LOGDIR/stdin.$n"
`,
  docker: `#!/bin/sh
echo "docker $*" >> "$LOGDIR/calls"
case "$1 $2" in "manifest inspect") [ "$PUBLISHED" = yes ] && { echo '{}'; exit 0; }; echo 'no such manifest' >&2; exit 1 ;; esac
exit 0
`,
  curl: `#!/bin/sh
echo "curl $*" >> "$LOGDIR/calls"
printf '{"app":"luxmark","version":"%s","commit":"abc1234"}' "$LIVE"
`,
};

function run(target, { published = 'yes', live = VERSION, local = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'luxmark-deploy-'));
  for (const f of ['Makefile', 'compose.yml', 'VERSION']) copyFileSync(join(root, f), join(dir, f));
  if (local) {
    writeFileSync(join(dir, 'Makefile.local'), 'LUX_REGISTRY := reg.test\nPROD_JUMP := jump.test\nPROD_NODE := 10.0.0.9\nPROD_DIR := /opt/test/luxmark\n');
  }
  const bin = join(dir, 'bin');
  const logs = join(dir, 'logs');
  for (const d of [bin, logs]) spawnSync('mkdir', ['-p', d]);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const r = spawnSync('make', ['--no-print-directory', target], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOGDIR: logs, PUBLISHED: published, LIVE: live },
  });
  const files = readdirSync(logs);
  const calls = files.includes('calls') ? readFileSync(join(logs, 'calls'), 'utf8').split('\n').filter(Boolean) : [];
  const scripts = files.filter((f) => f.startsWith('stdin.')).sort().map((f) => readFileSync(join(logs, f), 'utf8'));
  return { dir, status: r.status, out: r.stdout + r.stderr, calls, scripts, trace: calls.join('\n') };
}

const sshCalls = (calls) => calls.filter((c) => c.startsWith('ssh '));

test('every remote step goes over ssh as `sh -s` with the work on stdin, never on the command line', () => {
  const r = run('prod-deploy');
  assert.equal(r.status, 0, r.out);
  const ssh = sshCalls(r.calls);
  assert.ok(ssh.length >= 2, r.trace);
  for (const c of ssh) {
    assert.equal(c, 'ssh -o BatchMode=yes jump.test ssh -o BatchMode=yes root@10.0.0.9 sh -s', `remote command text on the ssh line:\n${c}`);
  }
});

test('prod-sync delivers compose.yml byte for byte', () => {
  const r = run('prod-sync');
  assert.equal(r.status, 0, r.out);
  const script = r.scripts.join('\n');
  const b64 = script.match(/echo (\S+) \| base64 -d > compose\.yml\.new && mv compose\.yml\.new compose\.yml/);
  assert.ok(b64, `no compose.yml transfer in the script:\n${script}`);
  assert.equal(Buffer.from(b64[1], 'base64').toString('utf8'), readFileSync(join(root, 'compose.yml'), 'utf8'));
  assert.match(script, /cd \/opt\/test\/luxmark/);
  assert.match(script, /mv compose\.yaml compose\.yaml\.pre-compose-yml/, 'a stray compose.yaml must be renamed aside, never deleted');
  assert.doesNotMatch(script, /\brm\b/);
});

test('prod-deploy pins the node to VERSION, recreates through compose.yml, and waits for healthy', () => {
  const r = run('prod-deploy');
  assert.equal(r.status, 0, r.out);
  const deploy = r.scripts.at(-1);
  assert.match(deploy, new RegExp(`printf "TAG=%s\\\\n" "${VERSION.replace(/\./g, '\\.')}" > \\.env`));
  assert.match(deploy, /docker compose -f compose\.yml pull/);
  assert.match(deploy, /docker compose -f compose\.yml up -d --wait --wait-timeout \d+/);
  assert.match(r.out, new RegExp(`live: .* serves ${VERSION.replace(/\./g, '\\.')} `));
});

test('prod-deploy refuses a VERSION that is not published, before touching the node', () => {
  const r = run('prod-deploy', { published: 'no' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /is not published/);
  assert.equal(r.scripts.filter((s) => s.includes('docker compose')).length, 0, r.trace);
});

test('prod-deploy fails when the live site does not report VERSION afterwards', () => {
  const r = run('prod-deploy', { live: '1.0.5' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /DEPLOY NOT LIVE/);
});

test('the prod targets refuse to run without the node topology in Makefile.local', () => {
  const r = run('prod-deploy', { local: false });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /PROD_JUMP \/ PROD_NODE \/ PROD_DIR unset/);
  assert.equal(sshCalls(r.calls).length, 0, r.trace);
});
