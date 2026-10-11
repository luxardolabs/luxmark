// Locks the release gate in the Makefile's `publish_version` (docker-push-local / -ghcr).
//
// A release tag is immutable: prod pins it. So :$(VERSION) may only be pointed at the DIGEST of a
// candidate this run built from a provably clean tree, pushed to the private registry, and scanned
// on every platform, and never over a version already released from another commit. Each case runs
// the real recipe through make against a fake `docker` that logs its argv, in a throwaway git repo
// holding this Makefile, and asserts what reached a registry.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const DIGEST = 'sha256:' + 'ab'.repeat(32);
const PRIVATE = 'reg.test/luxardolabs/luxmark';
const AMD64 = 'sha256:' + 'a1'.repeat(32);
const ARM64 = 'sha256:' + 'a2'.repeat(32);

// `imagetools inspect --format '{{json .Manifest}}'` is PRETTY-printed by buildx (`"digest": "…"`, the
// index digest first, then each platform's); the fake prints it the same way.
// MANIFEST: notfound | exists | unreachable   REVISION: revision label of an existing :VERSION
// SCAN: pass | fail   PLATS: amd64only drops arm64 from the candidate's index
const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$DOCKER_LOG"
case "$1 $2" in
  "manifest inspect")
    case "$MANIFEST" in
      exists) echo '{"schemaVersion":2}'; exit 0 ;;
      unreachable) echo 'Get "https://reg/v2/": dial tcp: lookup reg: no such host' >&2; exit 1 ;;
      *) echo 'no such manifest: reg/x:1' >&2; exit 1 ;;
    esac ;;
  "buildx imagetools")
    case "$*" in
      *inspect*Image*) echo '{"linux/amd64":{"config":{"Labels":{"org.opencontainers.image.revision":"'"$REVISION"'"}}},"linux/arm64":{"config":{"Labels":{"org.opencontainers.image.revision":"'"$REVISION"'"}}}}' ;;
      *inspect*Manifest.Digest*) echo '"${DIGEST}"' ;;
      *inspect*--raw*) printf '{\\n  "manifests": [\\n    {"digest": "${AMD64}", "platform": {"os": "linux", "architecture": "amd64"}},\\n    {"digest": "${ARM64}", "platform": {"os": "linux", "architecture": "arm64"}},\\n    {"digest": "sha256:${'ee'.repeat(32)}", "platform": {"os": "unknown", "architecture": "unknown"}}\\n  ]\\n}\\n' | { [ "$PLATS" = amd64only ] && grep -v arm64 || cat; } ;;
      *inspect*Manifest*) printf '{\\n  "schemaVersion": 2,\\n  "mediaType": "application/vnd.oci.image.index.v1+json",\\n  "digest": "${DIGEST}",\\n  "size": 1609,\\n  "manifests": [\\n    {\\n      "digest": "sha256:${'cd'.repeat(32)}"\\n    }\\n  ]\\n}\\n' ;;
    esac; exit 0 ;;
  "buildx ls") exit 0 ;;
esac
if [ "$1" = save ]; then while [ $# -gt 0 ]; do [ "$1" = -o ] && echo tar > "$2"; shift; done; exit 0; fi
if [ "$1" = run ]; then case "$*" in *--image-archive*) [ "$SCAN" = fail ] && exit 1 ;; esac; fi
exit 0
`;

function sandbox() {
  const parent = mkdtempSync(join(tmpdir(), 'luxmark-release-'));
  const dir = join(parent, 'luxmark');
  mkdirSync(dir);
  copyFileSync(join(root, 'Makefile'), join(dir, 'Makefile'));
  writeFileSync(join(dir, 'VERSION'), `${VERSION}\n`);
  writeFileSync(join(parent, 'docker'), FAKE_DOCKER);
  chmodSync(join(parent, 'docker'), 0o755);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'sandbox');
  const commit = git('rev-parse', '--short', 'HEAD').toString().trim();
  return { parent, dir, commit };
}

function publish(target, { manifest = 'notfound', revision = '', scan = 'pass', plats = 'both', setup = () => {}, args = [], fromParent = false, env = {} } = {}) {
  const sb = sandbox();
  setup(sb);
  const log = join(sb.parent, 'docker.log');
  writeFileSync(log, '');
  const makeArgs = fromParent ? ['-C', 'luxmark'] : [];
  const r = spawnSync('make', ['--no-print-directory', ...makeArgs, ...args, target, 'LUX_REGISTRY=reg.test'], {
    cwd: fromParent ? sb.parent : sb.dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${sb.parent}:${process.env.PATH}`, DOCKER_LOG: log, MANIFEST: manifest, REVISION: typeof revision === 'function' ? revision(sb) : revision, SCAN: scan, PLATS: plats, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { ...sb, status: r.status, out: r.stdout + r.stderr, calls, trace: calls.join('\n') };
}

const TARGETS = {
  'docker-push-local': PRIVATE,
  'docker-push-ghcr': 'ghcr.io/luxardolabs/luxmark',
};
const promotions = (calls) => calls.filter((c) => c.startsWith('docker buildx imagetools create'));
const builds = (calls) => calls.filter((c) => c.startsWith('docker buildx build'));
const scans = (calls) => calls.filter((c) => c.includes('--image-archive'));

for (const [target, image] of Object.entries(TARGETS)) {
  test(`${target}: a clean, unreleased candidate is scanned, then promoted to :VERSION by digest`, () => {
    const r = publish(target);
    assert.equal(r.status, 0, r.out);
    const build = builds(r.calls);
    assert.equal(build.length, 1, r.trace);
    assert.match(build[0], new RegExp(`-t ${PRIVATE}:candidate-${r.commit} --push`), 'candidates go to the private registry only');
    assert.doesNotMatch(build[0], new RegExp(`:${VERSION}\\b`), 'the build must never push :VERSION directly');
    const promote = promotions(r.calls);
    assert.deepEqual(promote, [`docker buildx imagetools create -t ${image}:${VERSION} ${PRIVATE}@${DIGEST}`]);
    const lastScan = r.calls.lastIndexOf(scans(r.calls).at(-1));
    assert.ok(lastScan >= 0 && r.calls.indexOf(promote[0]) > lastScan, `every scan must run before :VERSION is created\n${r.trace}`);
  });

  test(`${target}: a failed scan never creates :VERSION`, () => {
    const r = publish(target, { scan: 'fail' });
    assert.notEqual(r.status, 0);
    assert.equal(promotions(r.calls).length, 0, r.trace);
  });
}

test('every platform of the candidate digest is scanned, each against this repo\'s .luxaudit.toml', () => {
  const r = publish('docker-push-ghcr', { fromParent: true });
  assert.equal(r.status, 0, r.out);
  // Each platform by its OWN manifest digest: pulling the shared index digest per platform makes the
  // second pull fail with "cannot overwrite digest" (seen on the first real 2026.10.0 run).
  for (const d of [AMD64, ARM64]) {
    assert.ok(r.calls.includes(`docker pull -q ${PRIVATE}@${d}`), `${d} not pulled by its own digest\n${r.trace}`);
  }
  assert.ok(!r.calls.some((c) => c.includes('unknown') || c.includes('ee'.repeat(32))), 'attestation entries are not images');
  const s = scans(r.calls);
  assert.equal(s.length, 2, r.trace);
  for (const c of s) assert.ok(c.includes(`-v ${r.dir}:/repo `), `scan must mount the repo, not the caller's directory:\n${c}`);
});

test('a candidate missing a platform in $(PLATFORM) is refused, never promoted', () => {
  const r = publish('docker-push-ghcr', { plats: 'amd64only' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /linux\/arm64/);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('make -i cannot skip past a failed scan into a promotion', () => {
  const r = publish('docker-push-ghcr', { scan: 'fail', args: ['-i'] });
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('make -i cannot skip past an already-released VERSION into a build', () => {
  const r = publish('docker-push-ghcr', { manifest: 'exists', revision: 'f00f00f', args: ['-i'] });
  assert.equal(builds(r.calls).length, 0, r.trace);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('a VERSION already released from another commit is refused before anything is built', () => {
  const r = publish('docker-push-ghcr', { manifest: 'exists', revision: 'f00f00f' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /already RELEASED/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a refused re-release names the per-registry targets that resume an interrupted release', () => {
  const r = publish('docker-push-ghcr', { manifest: 'exists', revision: (sb) => sb.commit });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /make release-ghcr if GHCR is still missing it/);
  assert.equal(builds(r.calls).length, 0, r.trace);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('an unreachable registry fails closed (never reads as unreleased)', () => {
  const r = publish('docker-push-ghcr', { manifest: 'unreachable' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /cannot verify/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a dirty working tree is refused before anything is built', () => {
  const r = publish('docker-push-ghcr', { setup: (s) => writeFileSync(join(s.dir, 'stray.txt'), 'uncommitted\n') });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /working tree is dirty/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a dirty tree in a checkout git distrusts (another uid) is still refused', () => {
  const r = publish('docker-push-ghcr', {
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    setup: (s) => {
      writeFileSync(join(s.dir, 'stray.txt'), 'uncommitted\n');
      execFileSync('chown', ['-R', '4242:4242', s.dir]);
    },
  });
  assert.notEqual(r.status, 0, r.out);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a git status that fails is a refusal, never an empty "clean"', () => {
  const r = publish('docker-push-ghcr', { setup: (s) => writeFileSync(join(s.dir, '.git', 'HEAD'), 'garbage\n') });
  assert.notEqual(r.status, 0, r.out);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

