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

test('the container answers as `luxmark` on the edge network the environment names', () => {
  // Prod: the OVH edge (nginx-ovh conf.d/luxmark.luxardolabs.com.conf) proxies to http://luxmark:8080
  // on the shared `luxardolabs` network, so the default network is that one and the container carries
  // the alias. Dev: .env.dev names `dev-edge` and the address infra pinned, which the dev edge routes to.
  assert.match(compose, /^\s+container_name:\s*luxmark-web\s*$/m);
  assert.match(compose, /^\s+networks:\n\s+edge:\n\s+aliases:\n\s+- luxmark\n\s+ipv4_address: \$\{EDGE_IPV4:-\}\s*$/m);
  assert.match(compose, /^networks:\n\s+edge:\n\s+name: \$\{EDGE_NETWORK:-luxardolabs\}\n\s+external: true\s*$/m);
});

test('compose.yml publishes no host port: every edge reaches the container over its network', () => {
  // A host publish lets anything on the node reach nginx around the edge (no TLS, no edge headers),
  // and on the shared dev host two stacks cannot hold one port. Self-hosting publishes with docker run.
  assert.doesNotMatch(compose, /^\s+ports:/m);
});
