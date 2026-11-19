# Docker Deployment Guide

This guide covers building, running, and deploying LuxMark with Docker.

## Quick Start

```bash
# Run a published release on a host port
docker run -d -p 8080:8080 --name luxmark ghcr.io/luxardolabs/luxmark:2026.11.0

# Or build and run from source
docker build -t luxmark .
docker run -d -p 8080:8080 --name luxmark luxmark
```

Access LuxMark at `http://localhost:8080`

compose.yml is the stack behind a reverse proxy: it publishes no host port, and the proxy reaches the container as `luxmark:8080` on a shared docker network (`EDGE_NETWORK`, default `luxardolabs`).

## Docker Compose

### Development

```bash
cp .env.example .env     # set TAG to the release you want, e.g. TAG=2026.11.0
docker network create luxardolabs 2>/dev/null || true   # the proxy's network; compose.yml joins it
docker compose up -d     # needs TAG in .env (compose.yml uses ${TAG:?})
docker compose logs -f
docker compose down
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name luxmark.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://luxmark:8080;   # nginx on the same docker network (EDGE_NETWORK); with `docker run -p`, 127.0.0.1:<port>
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik

```yaml
services:
  luxmark:
    image: ghcr.io/luxardolabs/luxmark:2026.11.0
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.luxmark.rule=Host(`luxmark.yourdomain.com`)"
      - "traefik.http.routers.luxmark.tls=true"
      - "traefik.http.routers.luxmark.tls.certresolver=letsencrypt"
    networks:
      - traefik

networks:
  traefik:
    external: true
```

## Multi-Architecture Builds

```bash
# Build for ARM64 (e.g., Raspberry Pi, Apple Silicon)
docker buildx build --platform linux/arm64 -t luxmark:arm64 .

# Build multi-arch
docker buildx build --platform linux/amd64,linux/arm64 -t luxmark:latest .
```

## Security

The Docker image includes:

- **Alpine Linux base** — minimal attack surface (~25MB total image)
- **Non-root nginx user** — reduced privileges
- **Read-only filesystem** — with tmpfs for cache directories
- **Security headers** — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **No new privileges** flag — prevents privilege escalation

## Customization

### Change Port

Choose the host port with `docker run -p <port>:8080` (`-p 127.0.0.1:<port>:8080` keeps it on loopback). Under compose the container publishes nothing; your proxy chooses the public port.

## Image Size

- Base: nginx:alpine (~9MB)
- App files: ~450KB
- Total: ~25MB

## Troubleshooting

### View Logs

```bash
docker logs luxmark-web
docker compose logs -f
```

### Debug Shell

```bash
docker run -it --rm -p 8080:8080 luxmark sh
```

### Build Cache Issues

```bash
docker builder prune -f
docker build --no-cache -t luxmark .
```

## Updating

```bash
# Move to a new release: set TAG in .env, then pull and recreate
sed -i 's/^TAG=.*/TAG=2026.11.0/' .env
docker compose pull
docker compose up -d --wait
docker exec luxmark-web wget -qO- http://127.0.0.1:8080/version.json   # should report the new version
```

Maintainers release with `make release`, then `make release-public`, which publishes the version and `:latest` to GHCR and then the GitHub Release, so a Release never names a version you cannot pull. They then deploy the hosted site with `make prod-deploy` (see the Makefile's Production section). Every release is a new, newest CalVer version, so `:latest` moves with each one.
