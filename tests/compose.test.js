// Locks the compose healthcheck to an IPv4 loopback address.
//
// nginx in the image listens on IPv4 only (`listen 8080;` in docker/nginx.conf), and busybox wget
// resolves `localhost` to ::1 first, so a healthcheck aimed at localhost is refused and the container
// reports unhealthy while serving fine. That happened in prod; nothing at runtime says why.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compose = readFileSync(join(root, 'compose.yml'), 'utf8');
const nginxConf = readFileSync(join(root, 'docker/nginx.conf'), 'utf8');

test('compose healthcheck targets 127.0.0.1, not localhost', () => {
  const line = compose.split('\n').find((l) => /^\s*test:\s*\[/.test(l));
  assert.ok(line, 'compose.yml has no healthcheck test line');
  assert.match(line, /http:\/\/127\.0\.0\.1:8080\//);
  assert.doesNotMatch(line, /localhost/);
});

test('nginx still listens IPv4-only, so the 127.0.0.1 healthcheck still applies', () => {
  // If nginx gains an IPv6 listener this test should be revisited along with the healthcheck.
  assert.doesNotMatch(nginxConf, /listen\s+\[::\]/);
});
