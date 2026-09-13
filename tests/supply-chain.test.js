// luxmark's test suite — Node's built-in test runner (`node:test`), no npm install, no build step,
// matching how this repo ships.
//
// WHAT THESE TESTS ARE FOR, and what they deliberately are not:
//
// luxmark renders in a browser, so the rendering path (marked -> KaTeX -> DOMPurify -> innerHTML)
// cannot be honestly verified without one. These tests therefore lock the properties that ARE
// checkable from the files, and those happen to be the ones that bite silently:
//
//   * every third-party script the page executes is pinned to an immutable version and carries an
//     SRI hash, so a CDN cannot change the code running in a visitor's browser
//   * markdown still passes through a sanitizer before it reaches innerHTML
//   * the declared JS globals still match the script tags they describe
//
// Each of those was broken or absent before the guards were wired, and each fails silently — nothing
// at runtime tells you the hash went missing. Rendering, by contrast, breaks visibly the moment you
// open the page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src/index.html'), 'utf8');
const appJs = readFileSync(join(root, 'src/js/app.js'), 'utf8');
const luxlintToml = readFileSync(join(root, '.luxlint.toml'), 'utf8');

/** Every <script src> / <link rel=stylesheet> pointing off-origin, with its attributes. */
function externalTags() {
  const out = [];
  for (const m of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const [, tag, attrs] = m;
    const url = (attrs.match(/(?:src|href)\s*=\s*"([^"]+)"/i) || [])[1];
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (tag.toLowerCase() === 'link') {
      const rel = (attrs.match(/rel\s*=\s*"([^"]*)"/i) || [, ''])[1].toLowerCase();
      // preconnect/icon fetch no executable bytes
      if (!rel || /\b(preconnect|dns-prefetch|icon|manifest)\b/.test(rel)) continue;
    }
    out.push({ tag, url, attrs });
  }
  return out;
}

// Google Fonts' css2 endpoint returns a UA-specific stylesheet, so it can carry neither a version
// nor a stable hash by construction. Excluded here for the same reason the guard excludes it.
const uaVariant = (url) => url.includes('fonts.googleapis.com');

test('every external dependency is pinned to an immutable version', () => {
  const unpinned = externalTags()
    .filter(({ url }) => !uaVariant(url))
    .filter(({ url }) => !/@\d[\w.+-]*|\/v?\d+\.\d+[\w.+-]*\//.test(url))
    .map(({ url }) => url);
  assert.deepEqual(
    unpinned,
    [],
    'an unpinned CDN URL resolves to whatever the registry calls latest AT REQUEST TIME — the code ' +
      'running in a visitor\'s browser can then change with no commit and no deploy'
  );
});

test('every external dependency carries an SRI hash AND crossorigin', () => {
  // Both halves matter: SRI is not enforced on a cross-origin request without `crossorigin`, so a
  // hash on its own is decorative.
  const bad = externalTags()
    .filter(({ url }) => !uaVariant(url))
    .filter(({ attrs }) => !/integrity\s*=\s*"sha\d{3}-/i.test(attrs) || !/\bcrossorigin\b/i.test(attrs))
    .map(({ url }) => url);
  assert.deepEqual(bad, [], 'without enforced SRI a compromised CDN response executes unnoticed');
});

test('there is at least one external dependency to check', () => {
  // Guards the tests above against passing vacuously if the tag-scanning regex ever stops matching —
  // a green that scanned nothing is the failure mode, not the pass.
  assert.ok(externalTags().length >= 10, `expected the real CDN set, found ${externalTags().length}`);
});

test('rendered markdown is sanitized before it reaches innerHTML', () => {
  // marked is NOT a sanitizer — it dropped its `sanitize` option and documents DOMPurify. Today the
  // only content source is what the local user types, so an injection is self-inflicted; that stops
  // being true the moment anything else can supply a document (share-by-URL, open-a-file,
  // paste-as-HTML), and at that point unsanitized markup can read every saved document out of
  // localStorage.
  const sinkLines = appJs.split('\n').filter((l) => /\.innerHTML\s*=(?!=)/.test(l));
  assert.ok(sinkLines.length > 0, 'expected at least one innerHTML write to verify');
  for (const line of sinkLines) {
    assert.match(line, /DOMPurify\.sanitize/, `unsanitized write into innerHTML: ${line.trim()}`);
  }
});

test('declared JS globals match the scripts the page actually loads', () => {
  // .luxlint.toml's [js].globals is what makes eslint's no-undef meaningful. If it drifts from the
  // script tags, either a real typo stops being reported or a removed library lingers as a lie.
  const declared = new Set(
    [...luxlintToml.matchAll(/^\s*"([A-Za-z_$][\w$]*)",/gm)].map((m) => m[1])
  );
  for (const name of ['marked', 'DOMPurify', 'hljs', 'katex', 'CodeMirror']) {
    assert.ok(declared.has(name), `[js].globals is missing "${name}"`);
  }
  // DOMPurify is only a global because index.html loads it — keep the two in step.
  assert.match(html, /dompurify@/, 'DOMPurify is declared as a global but not loaded by the page');
});
