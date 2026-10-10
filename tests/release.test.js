// Locks the release gate in the Makefile's `publish_version` (docker-push-local / -hub / -ghcr).
//
// A release tag is immutable: prod pins it. So :$(VERSION) may only be pointed at a candidate image
// that this run built from a clean tree and scanned, and never pushed over a version already in the
// registry. Each case runs the real recipe through make against a fake `docker` that logs its argv,
// in a throwaway git repo holding this Makefile, and asserts what reached the registry.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(root, 'VERSION'), 'utf8').trim();

// MANIFEST: notfound | exists | unreachable     SCAN: pass | fail
const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$DOCKER_LOG"
case "$1 $2" in
  "manifest inspect")
    case "$MANIFEST" in
      exists) echo '{"schemaVersion":2}'; exit 0 ;;
      unreachable) echo 'Get "https://reg/v2/": dial tcp: lookup reg: no such host' >&2; exit 1 ;;
      *) echo 'no such manifest: reg/x:1' >&2; exit 1 ;;
    esac ;;
  "buildx ls") exit 0 ;;
esac
if [ "$1" = save ]; then while [ $# -gt 0 ]; do [ "$1" = -o ] && : > "$2"; shift; done; exit 0; fi
if [ "$1" = run ]; then case "$*" in *--image-archive*) [ "$SCAN" = fail ] && exit 1 ;; esac; fi
exit 0
`;

function sandbox({ dirty = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'luxmark-release-'));
  copyFileSync(join(root, 'Makefile'), join(dir, 'Makefile'));
  writeFileSync(join(dir, 'VERSION'), `${VERSION}\n`);
  writeFileSync(join(dir, 'docker'), FAKE_DOCKER);
  chmodSync(join(dir, 'docker'), 0o755);
  writeFileSync(join(dir, '.gitignore'), 'docker\ndocker.log\n');
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'sandbox');
  if (dirty) writeFileSync(join(dir, 'VERSION'), `${VERSION}\n# uncommitted\n`);
  return dir;
}

function publish(target, { manifest = 'notfound', scan = 'pass', dirty = false } = {}) {
  const dir = sandbox({ dirty });
  const log = join(dir, 'docker.log');
  writeFileSync(log, '');
  const r = spawnSync('make', ['--no-print-directory', target, 'LUX_REGISTRY=reg.test'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DOCKER_LOG: log, MANIFEST: manifest, SCAN: scan },
  });
  return { status: r.status, out: r.stdout + r.stderr, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

const TARGETS = {
  'docker-push-local': `reg.test/luxardolabs/luxmark`,
  'docker-push-hub': `luxardolabs/luxmark`,
  'docker-push-ghcr': `ghcr.io/luxardolabs/luxmark`,
};
const releases = (calls, image) => calls.filter((c) => c.startsWith('docker buildx imagetools create') && c.includes(`-t ${image}:${VERSION} `));
const builds = (calls) => calls.filter((c) => c.startsWith('docker buildx build'));

for (const [target, image] of Object.entries(TARGETS)) {
  test(`${target}: a clean, unreleased, scanned candidate is promoted to :VERSION`, () => {
    const r = publish(target);
    assert.equal(r.status, 0, r.out);
    const build = builds(r.calls);
    assert.equal(build.length, 1, r.calls.join('\n'));
    assert.match(build[0], new RegExp(`-t ${image}:candidate-\\S+ --push`));
    assert.doesNotMatch(build[0], new RegExp(`-t ${image}:${VERSION}\\b`), 'the build must never push :VERSION directly');
    const scan = r.calls.findIndex((c) => c.includes('--image-archive'));
    const promote = r.calls.findIndex((c) => releases([c], image).length);
    assert.ok(scan >= 0 && promote > scan, `scan must run before :VERSION is created\n${r.calls.join('\n')}`);
  });

  test(`${target}: a failed scan never creates :VERSION`, () => {
    const r = publish(target, { scan: 'fail' });
    assert.notEqual(r.status, 0);
    assert.equal(releases(r.calls, image).length, 0, r.calls.join('\n'));
  });
}

test('an already-released VERSION is refused before anything is built', () => {
  const r = publish('docker-push-ghcr', { manifest: 'exists' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /already RELEASED/);
  assert.equal(builds(r.calls).length, 0, r.calls.join('\n'));
});

test('an unreachable registry fails closed (never reads as unreleased)', () => {
  const r = publish('docker-push-ghcr', { manifest: 'unreachable' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /cannot verify/);
  assert.equal(builds(r.calls).length, 0, r.calls.join('\n'));
});

test('a dirty working tree is refused before anything is built', () => {
  const r = publish('docker-push-ghcr', { dirty: true });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /working tree is dirty/);
  assert.equal(builds(r.calls).length, 0, r.calls.join('\n'));
});
