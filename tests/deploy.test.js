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

// ssh: logs its argv, saves each stdin script, then RUNS it here: the sandbox node is PROD_DIR on this machine. docker: `manifest inspect` per PUBLISHED.
// curl: serves a version.json reporting LIVE.
const FAKES = {
  ssh: `#!/bin/sh
n=$(ls "$LOGDIR" | grep -c '^stdin') ; echo "ssh $*" >> "$LOGDIR/calls"
cat > "$LOGDIR/stdin.$n"
sh "$LOGDIR/stdin.$n"
`,
  docker: `#!/bin/sh
echo "docker $*" >> "$LOGDIR/calls"
case "$1 $2" in "manifest inspect") [ "$PUBLISHED" = yes ] && { echo '{}'; exit 0; }; echo 'no such manifest' >&2; exit 1 ;; esac
exit 0
`,
  curl: `#!/bin/sh
echo "curl $*" >> "$LOGDIR/calls"
if [ -n "$LIVEJSON" ]; then printf '%s' "$LIVEJSON"; else printf '{"app":"luxmark","version":"%s","commit":"abc1234"}' "$LIVE"; fi
`,
};

function run(target, { published = 'yes', live = VERSION, liveJson = '', local = true, node = () => {}, args = [], fakes = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'luxmark-deploy-'));
  const prodDir = join(dir, 'node');
  spawnSync('mkdir', ['-p', prodDir]);
  node(prodDir);
  for (const f of ['Makefile', 'compose.yml', 'VERSION']) copyFileSync(join(root, f), join(dir, f));
  if (local) {
    writeFileSync(join(dir, 'Makefile.local'), 'LUX_REGISTRY := reg.test\nPROD_JUMP := jump.test\nPROD_NODE := 10.0.0.9\nPROD_DIR := ' + prodDir + '\n');
  }
  const bin = join(dir, 'bin');
  const logs = join(dir, 'logs');
  for (const d of [bin, logs]) spawnSync('mkdir', ['-p', d]);
  for (const [name, body] of Object.entries({ ...FAKES, ...fakes })) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const r = spawnSync('make', ['--no-print-directory', target, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOGDIR: logs, PUBLISHED: published, LIVE: live, LIVEJSON: liveJson },
  });
  const files = readdirSync(logs);
  const calls = files.includes('calls') ? readFileSync(join(logs, 'calls'), 'utf8').split('\n').filter(Boolean) : [];
  const scripts = files.filter((f) => f.startsWith('stdin.')).sort().map((f) => readFileSync(join(logs, f), 'utf8'));
  return { dir, prodDir, status: r.status, out: r.stdout + r.stderr, calls, scripts, trace: calls.join('\n') };
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

test('prod-sync delivers compose.yml byte for byte, verified against its checksum before it replaces anything', () => {
  const r = run('prod-sync');
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(join(r.prodDir, 'compose.yml'), 'utf8'), readFileSync(join(root, 'compose.yml'), 'utf8'));
  assert.match(r.scripts.join('\n'), /sha256sum -c/);
  assert.doesNotMatch(r.scripts.join('\n'), /\brm\b/);
});

test('a failed write on the node fails prod-sync and leaves the node compose.yml untouched', () => {
  const r = run('prod-sync', {
    node: (d) => { writeFileSync(join(d, 'compose.yml'), 'OLD\n'); spawnSync('mkdir', ['-p', join(d, 'compose.yml.new')]); },
  });
  assert.notEqual(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /synced compose\.yml/);
  assert.equal(readFileSync(join(r.prodDir, 'compose.yml'), 'utf8'), 'OLD\n');
});

test('an empty local encoding is refused, never shipped as an empty compose.yml', () => {
  const r = run('prod-sync', {
    node: (d) => writeFileSync(join(d, 'compose.yml'), 'OLD\n'),
    fakes: { base64: '#!/bin/sh\nexit 0\n' },
  });
  assert.notEqual(r.status, 0, r.out);
  assert.equal(readFileSync(join(r.prodDir, 'compose.yml'), 'utf8'), 'OLD\n');
});

test('a stray compose.yaml is renamed aside, and an earlier backup is never overwritten', () => {
  const r = run('prod-sync', {
    node: (d) => { writeFileSync(join(d, 'compose.yaml'), 'SECOND\n'); writeFileSync(join(d, 'compose.yaml.pre-compose-yml'), 'FIRST\n'); },
  });
  assert.equal(r.status, 0, r.out);
  const kept = readdirSync(r.prodDir).filter((f) => f.startsWith('compose.yaml')).map((f) => readFileSync(join(r.prodDir, f), 'utf8')).sort();
  assert.deepEqual(kept, ['FIRST\n', 'SECOND\n']);
  assert.ok(!readdirSync(r.prodDir).includes('compose.yaml'), 'compose.yaml must be moved aside');
});

test('prod-deploy pins TAG=VERSION, keeps every other node setting, and recreates through compose.yml', () => {
  const r = run('prod-deploy', { node: (d) => writeFileSync(join(d, '.env'), 'TAG=1.0.5\nPORT=18080\nLUXMARK_IMAGE=reg.example/luxmark\n') });
  assert.equal(r.status, 0, r.out);
  const env = readFileSync(join(r.prodDir, '.env'), 'utf8').split('\n').filter(Boolean).sort();
  assert.deepEqual(env, ['LUXMARK_IMAGE=reg.example/luxmark', 'PORT=18080', `TAG=${VERSION}`]);
  assert.ok(r.calls.includes('docker compose -f compose.yml pull'), r.trace);
  assert.ok(r.calls.some((c) => /^docker compose -f compose\.yml up -d --wait --wait-timeout \d+$/.test(c)), r.trace);
  assert.match(r.out, new RegExp(`live: .* serves ${VERSION.replace(/\./g, '\\.')}`));
});

test('prod-deploy refuses a VERSION that is not published, before touching the node', () => {
  const r = run('prod-deploy', { published: 'no' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /is not published/);
  assert.equal(sshCalls(r.calls).length, 0, `a refused deploy must not touch the node at all:\n${r.trace}`);
});

test('prod-deploy fails when the live site does not report VERSION afterwards', () => {
  const r = run('prod-deploy', { live: '1.0.5' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /DEPLOY NOT LIVE/);
});

test('a rollback to a release whose version.json has no top-level commit still verifies', () => {
  // 1.0.5's version.json nests the commit under git.commit; only `version` is compared.
  const r = run('prod-deploy', { args: ['MANUAL_VERSION=1.0.5'], liveJson: '{"app":"luxmark","version":"1.0.5","git":{"branch":"main","commit":"n/a"}}' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /live: .* serves 1\.0\.5/);
});

test('the prod targets refuse to run without the node topology in Makefile.local', () => {
  const r = run('prod-deploy', { local: false });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /PROD_JUMP \/ PROD_NODE \/ PROD_DIR unset/);
  assert.equal(sshCalls(r.calls).length, 0, r.trace);
});
