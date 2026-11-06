# Changelog

Per-version technical change logs live in **[`src/change_logs/`](src/change_logs/)**, one file per release (`<VERSION>.md`). User-facing notes live in **[`src/release_notes/`](src/release_notes/)** — see [RELEASE_NOTES.md](RELEASE_NOTES.md).

Writing guide: [`src/change_logs/writing-guide.md`](src/change_logs/writing-guide.md).

## Current

- **[2026.11.0](src/change_logs/2026.11.0.md)** — replaces the vulnerable 2026.10.0 image (8 HIGH/CRITICAL OS CVEs); the runtime user cannot write the served app; secrets are kept out of the build context at any depth; releases and deploys go through the emitted fleet blocks (`make release`, `make prod-deploy`).

## Earlier (CalVer)

- **[2026.10.0](src/change_logs/2026.10.0.md)** — CSP drops script `unsafe-inline`/`unsafe-eval`; base image patched (10 HIGH CVEs); releases scanned on every platform before publishing.

- **[2026.09.0](src/change_logs/2026.09.0.md)** — onboarded to the fleet guards; CDN supply chain pinned and hash-verified; rendered markdown sanitized; first test suite. Versioning moved SemVer → CalVer.

## Before CalVer (historical, SemVer)

Releases up to and including 1.0.5, one file each, as published. They are immutable history — version numbers are not rewritten.

- **[1.0.5](src/change_logs/1.0.5.md)** — 2026-03-12
- **[1.0.3](src/change_logs/1.0.3.md)** — 2025-10-09
- **[1.0.2](src/change_logs/1.0.2.md)** — 2025-09-15
- **[1.0.1](src/change_logs/1.0.1.md)** — 2025-08-20
- **[1.0.0](src/change_logs/1.0.0.md)** — 2025-08-01
