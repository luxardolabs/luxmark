// Locks `make release` — the emitted image block (v16) as this Makefile wires it: PLATFORMS amd64 +
// arm64, candidates in the private REGISTRY, the release in RELEASE_REGISTRY (GHCR).
//
// A release tag is immutable: prod pins it. So :$(VERSION) may only be pointed at the DIGEST of a
// candidate this run built from a provably clean, tagged tree, pushed to the private registry, and
// scanned on every platform, and never over a version already released. Each case runs the real
// recipe through make against a fake `docker` (and `gh`) that logs its argv, in a throwaway git repo
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
const HEX = 'ab'.repeat(32);
const PRIVATE = 'reg.test/luxardolabs/luxmark';
const GHCR = 'ghcr.io/luxardolabs/luxmark';

// MANIFEST: notfound | exists | unreachable   SCAN: pass | fail   DIGEST_OUT: what the digest read returns
// PLATS: amd64only makes the candidate's arm64 image unpullable
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
    case "$*" in *inspect*Manifest.Digest.Encoded*) echo "\${DIGEST_OUT:-${HEX}}" ;; esac; exit 0 ;;
  "buildx ls") exit 0 ;;
esac
if [ "$1" = pull ]; then case "$*" in *linux/arm64*) [ "$PLATS" = amd64only ] && { echo 'no matching manifest for linux/arm64' >&2; exit 1; } ;; esac; fi
if [ "$1" = save ]; then while [ $# -gt 0 ]; do [ "$1" = -o ] && echo tar > "$2"; shift; done; exit 0; fi
if [ "$1" = run ]; then case "$*" in *--image-archive*) [ "$SCAN" = fail ] && exit 1 ;; esac; fi
exit 0
`;

// gh: authenticated (GH_AUTH=fail: not), no Release exists yet (GH_EXISTS=yes: one does), `release create` succeeds.
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$DOCKER_LOG"
case "$1 $2" in
  "auth status") [ "$GH_AUTH" = fail ] && exit 1 ;;
  "release view") [ "$GH_EXISTS" = yes ] || exit 1 ;;
esac
exit 0
`;
// git whose `status` fails (exit 128, nothing on stdout) while every other command works, as in a
// checkout git distrusts: the clean-tree check must refuse on the failure, not read empty as clean.
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const FAILING_STATUS_GIT = `#!/bin/sh
for a in "$@"; do [ "$a" = status ] && { echo 'fatal: detected dubious ownership' >&2; exit 128; }; done
exec ${REAL_GIT} "$@"
`;

// tag: true (annotated, at HEAD, pushed to origin) | 'local' (at HEAD, never pushed) | false
function sandbox({ tag = true, registry = 'reg.test', local } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'luxmark-release-'));
  const dir = join(parent, 'luxmark');
  mkdirSync(dir);
  copyFileSync(join(root, 'Makefile'), join(dir, 'Makefile'));
  // The topology lives where the real repo keeps it: a gitignored Makefile.local. The block refuses a
  // REGISTRY from the shell or the command line, so it can only come from here.
  // `local` replaces that file's text; null leaves it out, as in a clean clone.
  if (local === undefined) writeFileSync(join(dir, 'Makefile.local'), `LUX_REGISTRY := ${registry}\nREGISTRY     := ${registry}\nPRIVATE_REGISTRY := ${registry}\n`);
  else if (local !== null) writeFileSync(join(dir, 'Makefile.local'), local);
  writeFileSync(join(dir, '.gitignore'), 'Makefile.local\n');
  // The block refuses a Dockerfile the commit does not hold; the fake docker never builds it.
  writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n');
  writeFileSync(join(dir, 'VERSION'), `${VERSION}\n`);
  for (const [name, body] of [['docker', FAKE_DOCKER], ['gh', FAKE_GH]]) {
    writeFileSync(join(parent, name), body);
    chmodSync(join(parent, name), 0o755);
  }
  mkdirSync(join(dir, 'src', 'release_notes'), { recursive: true });
  writeFileSync(join(dir, 'src', 'release_notes', `${VERSION}.md`), `# ${VERSION}\n`);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'sandbox');
  // The Release hangs off a tag on origin, so the sandbox has one.
  execFileSync('git', ['init', '-q', '--bare', join(parent, 'origin.git')]);
  git('remote', 'add', 'origin', join(parent, 'origin.git'));
  if (tag) {
    git('tag', '-a', `v${VERSION}`, '-m', 'v');
    if (tag !== 'local') git('push', '-q', 'origin', `v${VERSION}`);
  }
  return { parent, dir };
}

function release({ manifest = 'notfound', scan = 'pass', plats = 'both', tag = true, setup = () => {}, args = [], fromParent = false, env = {}, target = 'release', registry = 'reg.test', failStatus = false, local } = {}) {
  const sb = sandbox({ tag, registry, local });
  setup(sb);
  if (failStatus) {
    writeFileSync(join(sb.parent, 'git'), FAILING_STATUS_GIT);
    chmodSync(join(sb.parent, 'git'), 0o755);
  }
  const log = join(sb.parent, 'docker.log');
  writeFileSync(log, '');
  const makeArgs = fromParent ? ['-C', 'luxmark'] : [];
  const r = spawnSync('make', ['--no-print-directory', ...makeArgs, ...args, target], {
    cwd: fromParent ? sb.parent : sb.dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: sb.parent, PATH: `${sb.parent}:${process.env.PATH}`, DOCKER_LOG: log, MANIFEST: manifest, SCAN: scan, PLATS: plats, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { ...sb, status: r.status, out: r.stdout + r.stderr, calls, trace: calls.join('\n') };
}

const promotions = (calls) => calls.filter((c) => c.startsWith('docker buildx imagetools create'));
const builds = (calls) => calls.filter((c) => c.startsWith('docker buildx build') || c.startsWith('docker build '));
const scans = (calls) => calls.filter((c) => c.includes('--image-archive'));
const pushes = (calls) => calls.filter((c) => c.startsWith('docker push'));

test('a clean, tagged, unreleased candidate is built once, scanned, then created on GHCR by digest', () => {
  const r = release();
  assert.equal(r.status, 0, r.out);
  const build = builds(r.calls);
  assert.equal(build.length, 1, r.trace);
  assert.match(build[0], /--platform linux\/amd64,linux\/arm64 --push/);
  assert.match(build[0], new RegExp(`-t ${PRIVATE}:candidate-[0-9a-f]{12} `), 'candidates go to the private registry only');
  assert.doesNotMatch(build[0], /ghcr\.io/, 'nothing unscanned may reach the public registry');
  assert.doesNotMatch(build[0], new RegExp(`:${VERSION}\\b`), 'the build must never push :VERSION directly');
  assert.match(build[0], new RegExp(`--build-arg BUILD_VERSION=${VERSION} `), 'the image carries its version');
  assert.match(build[0], /--build-arg BUILD_COMMIT=[0-9a-f]{7,} /, 'the image carries its commit');
  assert.match(build[0], / --target production /, 'the release ships the production stage, never the test one');
  assert.match(build[0], / -f Dockerfile -t \S+ \.$/, 'built from THIS tree');
  assert.deepEqual(pushes(r.calls), [], 'a multi-arch release pushes only through buildx and imagetools');
  const promote = promotions(r.calls);
  assert.deepEqual(promote, [`docker buildx imagetools create -t ${GHCR}:${VERSION} ${PRIVATE}@sha256:${HEX}`]);
  const lastScan = r.calls.lastIndexOf(scans(r.calls).at(-1));
  assert.ok(lastScan >= 0 && r.calls.indexOf(promote[0]) > lastScan, `every scan must run before :VERSION is created\n${r.trace}`);
  const ghCreate = r.calls.findIndex((c) => c.startsWith('gh release create'));
  assert.ok(ghCreate > r.calls.indexOf(promote[0]), `the GitHub Release follows the image\n${r.trace}`);
  assert.match(r.calls[ghCreate], new RegExp(`--notes-file src/release_notes/${VERSION}\\.md`));
});

test('every platform of the candidate digest is scanned, each against this repo\'s .luxaudit.toml', () => {
  const r = release({ fromParent: true });
  assert.equal(r.status, 0, r.out);
  for (const p of ['linux/amd64', 'linux/arm64']) {
    assert.ok(r.calls.includes(`docker pull -q --platform ${p} ${PRIVATE}@sha256:${HEX}`), `${p} not pulled by digest\n${r.trace}`);
    // Without --platform, `docker save` of a multi-arch digest is not pinned to the platform just pulled.
    assert.ok(r.calls.some((c) => c.startsWith(`docker save --platform ${p} ${PRIVATE}@sha256:${HEX} -o `)), `${p} not saved by platform\n${r.trace}`);
  }
  const s = scans(r.calls);
  assert.equal(s.length, 2, r.trace);
  for (const c of s) assert.ok(c.includes(`-v ${r.dir}:/repo `), `scan must mount the repo, not the caller's directory:\n${c}`);
});

test('no :latest is ever created (a released version is the only public tag)', () => {
  const r = release();
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.calls.some((c) => c.includes(':latest')), r.trace);
});

test('a failed scan never creates :VERSION', () => {
  const r = release({ scan: 'fail' });
  assert.notEqual(r.status, 0);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('make -i cannot skip past a failed scan into a promotion', () => {
  const r = release({ scan: 'fail', args: ['-i'] });
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('a candidate missing a platform is refused, never promoted', () => {
  const r = release({ plats: 'amd64only' });
  assert.notEqual(r.status, 0);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('a VERSION already released is refused before anything is built', () => {
  const r = release({ manifest: 'exists' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /already PUBLISHED/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('make -i cannot skip past an already-released VERSION into a build', () => {
  const r = release({ manifest: 'exists', args: ['-i'] });
  assert.equal(builds(r.calls).length, 0, r.trace);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('an unreachable registry fails closed (never reads as unreleased)', () => {
  const r = release({ manifest: 'unreachable' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /cannot verify/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a VERSION not tagged at HEAD is refused before anything is built', () => {
  const r = release({ tag: false });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /not tagged at HEAD/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('no candidate build reads or writes a registry cache', () => {
  // A registry cache is written DURING the build, before the scan, and this image (nginx + ~450KB of
  // static files) gains nothing from one. Owner decision 2026-10-10: no build cache.
  for (const target of ['release', 'docker-build-local']) {
    const build = builds(release({ target }).calls);
    assert.equal(build.length, 1);
    assert.doesNotMatch(build[0], /--cache-(to|from)|BUILDKIT_INLINE_CACHE/, `${target}: ${build[0]}`);
  }
});

test('a dirty working tree is refused before anything is built', () => {
  const r = release({ setup: (s) => writeFileSync(join(s.dir, 'stray.txt'), 'uncommitted\n') });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /working tree is dirty/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a dirty tree in a checkout git distrusts (another uid) is still refused', () => {
  const r = release({
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
  const r = release({ setup: (s) => writeFileSync(join(s.dir, '.git', 'HEAD'), 'garbage\n') });
  assert.notEqual(r.status, 0, r.out);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a tag that exists only locally is refused before anything is built (the Release hangs off origin\'s tag)', () => {
  const r = release({ tag: 'local' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /is not on origin/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('an unauthenticated gh is refused before anything is built (never an image with no Release)', () => {
  const r = release({ env: { GH_AUTH: 'fail' } });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /gh is not authenticated/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('an unset registry is refused before anything is built', () => {
  const r = release({ registry: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /REGISTRY is empty/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('a git status that FAILS is refused by the clean-tree check itself, not by a later one', () => {
  const r = release({ failStatus: true });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /git status failed/);
  assert.equal(builds(r.calls).length, 0, r.trace);
});

test('an unreadable candidate digest is refused: nothing is pulled, scanned or promoted', () => {
  const r = release({ env: { DIGEST_OUT: 'not-a-digest' } });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /could not read the digest/);
  assert.equal(scans(r.calls).length, 0, r.trace);
  assert.equal(promotions(r.calls).length, 0, r.trace);
});

test('an existing GitHub Release is left as it is (a Release, like its tag, is immutable)', () => {
  const r = release({ env: { GH_EXISTS: 'yes' } });
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.calls.some((c) => c.startsWith('gh release create')), r.trace);
});

test('every file .gitignore ignores is kept out of the image\'s build context, at any depth', () => {
  // `git status` never lists an ignored file, so the clean-tree refusal cannot see one; only
  // .dockerignore keeps it out of the image (a stray src/js/notes.tmp was served by a real build).
  const ignored = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!') && !l.includes('/'));
  const docker = new Set(readFileSync(join(root, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim()));
  const missing = ignored.filter((p) => !docker.has(`**/${p}`) && !(p.startsWith('.env') && docker.has(p)) && p !== 'Makefile.local');
  assert.deepEqual(missing, [], 'add **/<pattern> to .dockerignore');
});

const anyPush = (calls) => builds(calls).concat(promotions(calls), pushes(calls));

for (const host of ['ghcr.io', 'docker.io']) {
  test(`a REGISTRY on a public host (${host}) is refused: an unscanned candidate never leaves the private registry`, () => {
    const r = release({ local: `LUX_REGISTRY := reg.test\nREGISTRY     := ${host}\nPRIVATE_REGISTRY := reg.test\n` });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(anyPush(r.calls).length, 0, r.trace);
  });
}

test('a Makefile.local without REGISTRY is refused before anything is built', () => {
  const r = release({ local: 'LUX_REGISTRY := reg.test\n' });
  assert.notEqual(r.status, 0, r.out);
  assert.equal(anyPush(r.calls).length, 0, r.trace);
});

for (const arg of ['LUXAUDIT_IMAGE=evil.example/always-pass:1', 'LUX_REGISTRY=evil.example']) {
  test(`the command line cannot choose the scanner (${arg.split('=')[0]})`, () => {
    const r = release({ args: [arg] });
    assert.deepEqual(r.calls.filter((c) => c.includes('evil.example')), [], r.trace);
  });
}

test('the command line cannot forge the commit the image says it was built from', () => {
  const r = release({ args: ['BUILD_COMMIT=0000000'] });
  assert.ok(!builds(r.calls).some((c) => c.includes('BUILD_COMMIT=0000000')), r.trace);
});

test('the command line cannot inject a build arg through BUILD_DATE', () => {
  const r = release({ args: ['BUILD_DATE=x --build-arg EVIL=1'] });
  assert.ok(!builds(r.calls).some((c) => c.includes('EVIL=1')), r.trace);
});

test('guard-upgrade refuses without REGISTRY, and leaves every pin as it is', () => {
  const r = release({ target: 'guard-upgrade', local: 'LUX_REGISTRY := reg.test\n' });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /REGISTRY is unset/);
  assert.equal(readFileSync(join(r.dir, 'Makefile'), 'utf8'), readFileSync(join(root, 'Makefile'), 'utf8'));
});

test('a Makefile.local without PRIVATE_REGISTRY is refused before anything is built', () => {
  const r = release({ local: 'LUX_REGISTRY := reg.test\nREGISTRY     := ghcr.io\n' });
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /PRIVATE_REGISTRY is empty/);
  assert.equal(anyPush(r.calls).length, 0, r.trace);
});
