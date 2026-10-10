// Locks the Content-Security-Policy script-src to no 'unsafe-inline' and no 'unsafe-eval'.
//
// Both were granted with nothing using them: index.html loads every script by src (the CDN tags plus
// js/app.js as a module), it has no inline handlers, and neither src/js nor any pinned CDN library
// calls eval / new Function. Granting them only re-opens the XSS paths CSP exists to close, which
// matters here because the preview renders user-supplied markdown as HTML.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nginxConf = readFileSync(join(root, 'docker/nginx.conf'), 'utf8');
const indexHtml = readFileSync(join(root, 'src/index.html'), 'utf8');

function scriptSrc() {
  const csp = nginxConf.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
  assert.ok(csp, 'docker/nginx.conf sends no Content-Security-Policy');
  const directive = csp[1].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  assert.ok(directive, 'the CSP has no script-src directive');
  return directive;
}

test('script-src grants neither unsafe-inline nor unsafe-eval', () => {
  const directive = scriptSrc();
  assert.doesNotMatch(directive, /'unsafe-inline'/);
  assert.doesNotMatch(directive, /'unsafe-eval'/);
});

test('index.html has no inline script the tightened policy would block', () => {
  // Every <script> must load by src; an inline block or on*= handler would need 'unsafe-inline'.
  const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>/g)];
  assert.ok(scripts.length > 0, 'index.html has no <script> tags at all — the scan is reading the wrong file');
  for (const [tag, attrs] of scripts) {
    assert.match(attrs, /\bsrc="/, `inline script: ${tag}`);
  }
  assert.doesNotMatch(indexHtml, /\son[a-z]+\s*=\s*["']/i, 'index.html carries an inline event handler');
});
