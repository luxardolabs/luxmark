# Docker Deployment Guide

This guide covers building, running, and deploying LuxMark with Docker.

## Quick Start

```bash
# Run a published release with Docker Compose (compose pulls; it never builds)
cp .env.example .env             # set TAG to the release you want, e.g. TAG=2026.10.0
docker network create luxardolabs 2>/dev/null || true   # compose.yml joins this external network
docker compose up -d

# Or build and run from source
docker build -t luxmark .
docker run -d -p 8080:8080 --name luxmark luxmark
```

Access LuxMark at `http://localhost:8080`

## Docker Compose

### Development

```bash
docker compose up -d     # needs TAG in .env (compose.yml uses ${TAG:?})
docker compose logs -f
docker compose down
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name luxmark.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
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
    build: .
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

Set `PORT` (and `LUXMARK_BIND`) in `.env`; compose.yml reads both:

```bash
PORT=3000             # host port
LUXMARK_BIND=0.0.0.0  # default 127.0.0.1 (loopback); 0.0.0.0 serves the page to your LAN directly
```

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
sed -i 's/^TAG=.*/TAG=2026.10.0/' .env
docker compose pull
docker compose up -d --wait
curl -s http://localhost:8080/version.json   # should report the new version
```

Maintainers deploy the hosted site with `make prod-deploy` after `make release` (see the Makefile's Production section).
