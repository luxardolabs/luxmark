compose.yml no longer publishes a host port, and its edge network and pinned address come from EDGE_NETWORK and EDGE_IPV4. Before the first `make prod-deploy` that syncs it:

- On the prod node, `docker compose version` must drop an empty `ipv4_address: ${EDGE_IPV4:-}` (Compose 5.x does): `docker compose -f compose.yml config --format json` there shows no `ipv4_address` for the `luxmark` service.
- Nothing on the prod node may read 127.0.0.1:8080: the OVH edge reaches the container as `luxmark:8080` on the `luxardolabs` network.

Heads-up for self-hosters (release notes): compose.yml no longer publishes a port; to serve LuxMark on a host port, use `docker run -p 8080:8080 ghcr.io/luxardolabs/luxmark:<version>` (docs/DOCKER.md).
