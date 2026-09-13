# Makefile for LuxMark
# Automatically detects version from directory structure

# Color definitions
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
RED := \033[0;31m
NC := \033[0m # No Color

# Site-local topology (registry host, any node names). Gitignored; copy Makefile.local.example.
-include Makefile.local

# Project name
PROJECT_NAME := luxmark

# Version — source of truth is the VERSION file at repo root
CURRENT_DIR := $(shell pwd)
VERSION := $(shell cat VERSION 2>/dev/null || git -c safe.directory=$(CURRENT_DIR) describe --tags --always 2>/dev/null || echo "0.0.0-dev")

# Allow manual override
ifdef MANUAL_VERSION
    VERSION := $(MANUAL_VERSION)
endif

ifeq ($(strip $(VERSION)),)
    $(error Unable to determine version — add a VERSION file at repo root or set MANUAL_VERSION=x.y.z)
endif

# Fleet guards — PINNED, immutable tags. `make guard-version-check` fails the gate when one is
# behind the published latest, and `make guard-upgrade` bumps them; never float these to :latest.
# Topology comes from the gitignored Makefile.local (see Makefile.local.example). This repo is
# PUBLIC, so no internal registry host is inlined here — the fleet gitleaks disclosure tier enforces
# that, and a clean clone still builds/lints because every recipe references the var, not a value.
LUX_REGISTRY     ?=
LUXARCH_VERSION  := 0.173.1
LUXLINT_VERSION  := 0.53.1
LUXAUDIT_VERSION := 0.7.0
LUXARCH_IMAGE    := $(LUX_REGISTRY)/luxardolabs/luxarch:$(LUXARCH_VERSION)
LUXLINT_IMAGE    := $(LUX_REGISTRY)/luxardolabs/luxlint:$(LUXLINT_VERSION)
LUXAUDIT_IMAGE   := $(LUX_REGISTRY)/luxardolabs/luxaudit:$(LUXAUDIT_VERSION)

# The ONE shared fleet buildx builder + its GC cap (repo.shared_buildx_builder,
# repo.buildx_builder_gc_capped).
BUILDX_BUILDER     ?= luxardo-builder
BUILDX_GC_KEEP     ?= 20gb
BUILDX_GC_DURATION ?= 168h

# Docker registry settings
LOCAL_REGISTRY ?= $(LUX_REGISTRY)
DOCKER_HUB_USER := luxardolabs
GITHUB_USER := luxardolabs
LOCAL_IMAGE := $(LOCAL_REGISTRY)/$(DOCKER_HUB_USER)/$(PROJECT_NAME)
DOCKER_HUB_IMAGE := $(DOCKER_HUB_USER)/$(PROJECT_NAME)
GHCR_IMAGE := ghcr.io/$(GITHUB_USER)/$(PROJECT_NAME)

# GHCR / registry auth rides on the HOST's stored docker login
# (~/.docker/config.json), same model as luxswirl — no token stored in this repo.
# If a host isn't logged in yet, run `make docker-login-ghcr` once.

# Build settings
BUILD_DATE := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
# The commit the image is built FROM — the revision label is worthless without it.
BUILD_COMMIT := $(shell git -c safe.directory=$(CURRENT_DIR) rev-parse --short HEAD 2>/dev/null || echo unknown)
# For quick local development builds - amd64 only (faster iteration)
PLATFORM_DEV := linux/amd64
# For release builds - multi-arch (amd64 + arm64)
PLATFORM := linux/amd64,linux/arm64
DOCKER_BUILDKIT := 1

# Default target
.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help message
	@echo '$(GREEN)LuxMark Makefile$(NC)'
	@echo ''
	@echo '$(BLUE)Detected Configuration:$(NC)'
	@echo '  Directory: $(CURRENT_DIR)'
	@echo '  Version: $(VERSION)'
	@echo '  Local Registry: $(LOCAL_IMAGE):$(VERSION)'
	@echo '  Docker Hub: $(DOCKER_HUB_IMAGE):$(VERSION)'
	@echo '  GHCR: $(GHCR_IMAGE):$(VERSION)'
	@echo ''
	@echo '$(BLUE)Available targets:$(NC)'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-25s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: validate-version
validate-version: ## Validate version detection
	@echo '$(BLUE)Version Validation:$(NC)'
	@echo '  Current Directory: $(CURRENT_DIR)'
	@echo '  Version (from VERSION file): $(VERSION)'
	@if [ -z "$(VERSION)" ]; then \
		echo '$(RED)ERROR: Could not determine version$(NC)'; \
		echo 'Add a VERSION file at repo root or set MANUAL_VERSION=x.y.z'; \
		exit 1; \
	else \
		echo '$(GREEN)Version validation passed!$(NC)'; \
	fi

.PHONY: docker-setup
docker-setup: ## Set up the ONE shared fleet buildx builder (GC-capped)
	@echo '$(BLUE)Setting up the shared fleet buildx builder...$(NC)'
	@# ONE shared builder across the fleet, not a per-project one: a builder per repo multiplies an
	@# uncapped cache by the number of repos and is how a disk fills silently.
	@if ! docker buildx inspect $(BUILDX_BUILDER) >/dev/null 2>&1; then \
	  printf '%s\n' \
	    '[worker.oci]' \
	    '  gc = true' \
	    '  [[worker.oci.gcpolicy]]' \
	    '    keepBytes = "$(BUILDX_GC_KEEP)"' \
	    '    keepDuration = "$(BUILDX_GC_DURATION)"' \
	    > /tmp/$(BUILDX_BUILDER)-buildkitd.toml; \
	  docker buildx create --name $(BUILDX_BUILDER) --driver docker-container --config /tmp/$(BUILDX_BUILDER)-buildkitd.toml; \
	fi
	docker buildx use $(BUILDX_BUILDER)
	docker buildx inspect --bootstrap

.PHONY: docker-login-hub
docker-login-hub: ## Login to Docker Hub (uses DOCKER_HUB_TOKEN env var or prompts)
	@echo '$(BLUE)Logging in to Docker Hub...$(NC)'
	@if [ -n "$$DOCKER_HUB_TOKEN" ]; then \
		echo "$$DOCKER_HUB_TOKEN" | docker login -u $(DOCKER_HUB_USER) --password-stdin; \
	else \
		docker login -u $(DOCKER_HUB_USER); \
	fi
	@echo '$(GREEN)Docker Hub login successful!$(NC)'

.PHONY: docker-login-ghcr
docker-login-ghcr: ## Login to GHCR on this host (one-time; uses GHCR_TOKEN env var or prompts)
	@echo '$(BLUE)Logging in to GitHub Container Registry...$(NC)'
	@if [ -n "$$GHCR_TOKEN" ]; then \
		echo "$$GHCR_TOKEN" | docker login ghcr.io -u $(GITHUB_USER) --password-stdin; \
	else \
		docker login ghcr.io -u $(GITHUB_USER); \
	fi
	@echo '$(GREEN)GHCR login successful!$(NC)'

.PHONY: docker-pull-cache
docker-pull-cache: ## Pull previous image for cache
	@echo '$(BLUE)Pulling previous image for cache...$(NC)'
	@docker pull $(LOCAL_IMAGE):latest 2>/dev/null || echo "No previous image found for cache (this is normal for first builds)"

.PHONY: docker-build-local
docker-build-local: validate-version docker-setup docker-pull-cache ## Build Docker image (local load, amd64 only for fast iteration)
	@echo '$(BLUE)Building Docker image for local use (amd64 only)...$(NC)'
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker buildx build \
		--platform $(PLATFORM_DEV) \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--cache-from $(LOCAL_IMAGE):latest \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		--label "org.opencontainers.image.created=$(BUILD_DATE)" \
		--label "org.opencontainers.image.version=$(VERSION)" \
		--label "org.opencontainers.image.title=LuxMark" \
		--label "org.opencontainers.image.description=A premium browser-based markdown editor with live preview" \
		--label "org.opencontainers.image.url=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.source=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.authors=luxardolabs" \
		-t $(LOCAL_IMAGE):$(VERSION) \
		-t luxardolabs/$(PROJECT_NAME):local \
		--load \
		.
	@echo '$(GREEN)Docker build complete!$(NC)'

.PHONY: build-local
build-local: ## Build for local architecture only (quick, no buildx)
	@echo '$(BLUE)Building $(LOCAL_IMAGE):$(VERSION) for local architecture...$(NC)'
	@docker build \
		--tag $(LOCAL_IMAGE):$(VERSION) \
		--tag luxardolabs/$(PROJECT_NAME):local \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		.
	@echo '$(GREEN)Build complete!$(NC)'

.PHONY: docker-push-local
docker-push-local: validate-version docker-setup docker-pull-cache ## Build and push to local registry (multi-arch: amd64 + arm64)
	@echo '$(BLUE)Building and pushing to local registry (multi-arch)...$(NC)'
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker buildx build \
		--platform $(PLATFORM) \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--cache-from $(LOCAL_IMAGE):latest \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		--label "org.opencontainers.image.created=$(BUILD_DATE)" \
		--label "org.opencontainers.image.version=$(VERSION)" \
		--label "org.opencontainers.image.title=LuxMark" \
		--label "org.opencontainers.image.description=A premium browser-based markdown editor with live preview" \
		--label "org.opencontainers.image.url=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.source=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.authors=luxardolabs" \
		-t $(LOCAL_IMAGE):$(VERSION) \
		--push \
		.
	@echo '$(GREEN)Pushed $(LOCAL_IMAGE):$(VERSION)$(NC)'

.PHONY: docker-push-hub
docker-push-hub: validate-version docker-setup docker-login-hub ## Build and push to Docker Hub (multi-arch: amd64 + arm64)
	@echo '$(BLUE)Pulling previous Docker Hub image for cache...$(NC)'
	@docker pull $(DOCKER_HUB_IMAGE):latest 2>/dev/null || echo "No previous image found for cache"
	@echo '$(BLUE)Building and pushing to Docker Hub (multi-arch)...$(NC)'
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker buildx build \
		--platform $(PLATFORM) \
		--build-arg BUILDKIT_INLINE_CACHE=1 \
		--cache-from $(DOCKER_HUB_IMAGE):latest \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		--label "org.opencontainers.image.created=$(BUILD_DATE)" \
		--label "org.opencontainers.image.version=$(VERSION)" \
		--label "org.opencontainers.image.title=LuxMark" \
		--label "org.opencontainers.image.description=A premium browser-based markdown editor with live preview" \
		--label "org.opencontainers.image.url=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.source=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.authors=luxardolabs" \
		-t $(DOCKER_HUB_IMAGE):$(VERSION) \
		--push \
		.
	@echo '$(GREEN)Pushed $(DOCKER_HUB_IMAGE):$(VERSION)$(NC)'

.PHONY: docker-push-ghcr
docker-push-ghcr: validate-version docker-setup ## Build and push to GHCR (multi-arch: amd64 + arm64; uses host docker login)
	@echo '$(BLUE)Building and pushing to GHCR (multi-arch)...$(NC)'
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker buildx build \
		--platform $(PLATFORM) \
		--cache-from type=registry,ref=$(GHCR_IMAGE):cache \
		--cache-to type=registry,ref=$(GHCR_IMAGE):cache,mode=max \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		--label "org.opencontainers.image.created=$(BUILD_DATE)" \
		--label "org.opencontainers.image.version=$(VERSION)" \
		--label "org.opencontainers.image.title=LuxMark" \
		--label "org.opencontainers.image.description=A premium browser-based markdown editor with live preview" \
		--label "org.opencontainers.image.url=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.source=https://github.com/luxardolabs/luxmark" \
		--label "org.opencontainers.image.authors=luxardolabs" \
		-t $(GHCR_IMAGE):$(VERSION) \
		--push \
		.
	@echo '$(GREEN)Pushed $(GHCR_IMAGE):$(VERSION)$(NC)'

.PHONY: docker-push-all
docker-push-all: docker-push-local docker-push-hub docker-push-ghcr ## Push to all registries (local, Docker Hub, GHCR)

.PHONY: docker-tag-latest-local
docker-tag-latest-local: require-registry ## Point local :latest at the EXISTING :$(VERSION) manifest
	@# `docker tag` + `docker push` publishes only the LOCAL architecture, so :latest would have
	@# silently lost linux/arm64 while :$(VERSION) kept it — an arm64 host pulling :latest would fail
	@# or get an emulated amd64 image, with nothing saying so. imagetools points the tag at the same
	@# multi-arch manifest.
	@echo '$(BLUE)Pointing local :latest at $(VERSION)...$(NC)'
	docker buildx imagetools create -t $(LOCAL_IMAGE):latest $(LOCAL_IMAGE):$(VERSION)
	@echo '$(GREEN)local :latest -> $(VERSION)$(NC)'

.PHONY: docker-tag-latest-hub
docker-tag-latest-hub: docker-login-hub ## Point Docker Hub :latest at the EXISTING :$(VERSION) manifest
	@# Retag, don't rebuild — see docker-tag-latest-ghcr for why (a rebuild produced a second image
	@# with revision=unknown). NOTE: luxardolabs/luxmark does not exist on Docker Hub; nothing has
	@# ever been published there. These targets are unused, not policy.
	@echo '$(BLUE)Pointing Docker Hub :latest at $(VERSION)...$(NC)'
	docker buildx imagetools create -t $(DOCKER_HUB_IMAGE):latest $(DOCKER_HUB_IMAGE):$(VERSION)
	@echo '$(GREEN)Docker Hub :latest -> $(VERSION)$(NC)'

.PHONY: docker-tag-latest-ghcr
docker-tag-latest-ghcr: ## Point GHCR :latest at the EXISTING :$(VERSION) manifest (no rebuild)
	@# RETAG, don't rebuild. The old recipe re-ran `buildx build ... -t :latest`, which produced a
	@# SECOND image for the same source — and it omitted --build-arg BUILD_COMMIT, so `latest` carried
	@# `revision=unknown` and a version.json with `"commit": "unknown"` while :$(VERSION) carried the
	@# real commit. Two images, same content, one with false provenance, and nothing would have said so.
	@# `imagetools create` points a new tag at the SAME multi-arch manifest, so the two tags are the
	@# identical digest by construction.
	@echo '$(BLUE)Pointing GHCR :latest at $(VERSION)...$(NC)'
	docker buildx imagetools create -t $(GHCR_IMAGE):latest $(GHCR_IMAGE):$(VERSION)
	@echo '$(GREEN)GHCR :latest -> $(VERSION)$(NC)'

.PHONY: docker-tag-latest
docker-tag-latest: docker-tag-latest-local docker-tag-latest-hub docker-tag-latest-ghcr ## Tag as latest in all registries

.PHONY: release-hub
release-hub: docker-push-hub docker-tag-latest-hub ## Release to Docker Hub only: version + latest (multi-arch)
	@echo ''
	@echo '$(GREEN)========================================$(NC)'
	@echo '$(GREEN)Docker Hub Release $(VERSION) complete!$(NC)'
	@echo '$(GREEN)========================================$(NC)'
	@echo ''
	@echo '$(BLUE)Images published (amd64 + arm64):$(NC)'
	@echo '  $(DOCKER_HUB_IMAGE):$(VERSION)'
	@echo '  $(DOCKER_HUB_IMAGE):latest'
	@echo ''
	@echo '$(BLUE)Pull command:$(NC)'
	@echo '  docker pull $(DOCKER_HUB_IMAGE):latest'

.PHONY: release-ghcr
release-ghcr: docker-push-ghcr docker-tag-latest-ghcr ## Release to GHCR only: version + latest (multi-arch)
	@echo ''
	@echo '$(GREEN)========================================$(NC)'
	@echo '$(GREEN)GHCR Release $(VERSION) complete!$(NC)'
	@echo '$(GREEN)========================================$(NC)'
	@echo ''
	@echo '$(BLUE)Images published (amd64 + arm64):$(NC)'
	@echo '  $(GHCR_IMAGE):$(VERSION)'
	@echo '  $(GHCR_IMAGE):latest'
	@echo ''
	@echo '$(BLUE)Pull command:$(NC)'
	@echo '  docker pull $(GHCR_IMAGE):latest'

.PHONY: release
release: docker-push-all docker-tag-latest ## Full release: version + latest to all registries (multi-arch)
	@echo ''
	@echo '$(GREEN)========================================$(NC)'
	@echo '$(GREEN)Release $(VERSION) complete!$(NC)'
	@echo '$(GREEN)========================================$(NC)'
	@echo ''
	@echo '$(BLUE)Images published (amd64 + arm64):$(NC)'
	@echo ''
	@echo '  $(YELLOW)Local Registry:$(NC)'
	@echo '    $(LOCAL_IMAGE):$(VERSION)'
	@echo '    $(LOCAL_IMAGE):latest'
	@echo ''
	@echo '  $(YELLOW)Docker Hub:$(NC)'
	@echo '    $(DOCKER_HUB_IMAGE):$(VERSION)'
	@echo '    $(DOCKER_HUB_IMAGE):latest'
	@echo ''
	@echo '  $(YELLOW)GHCR:$(NC)'
	@echo '    $(GHCR_IMAGE):$(VERSION)'
	@echo '    $(GHCR_IMAGE):latest'
	@echo ''
	@echo '$(BLUE)Pull commands:$(NC)'
	@echo '  docker pull $(DOCKER_HUB_IMAGE):latest'
	@echo '  docker pull $(GHCR_IMAGE):latest'

.PHONY: test
test: ## Run the test suite (node:test, in docker — no npm install, no build step)
	@echo '$(BLUE)Running the luxmark test suite...$(NC)'
	docker run --rm -v $(PWD):/w -w /w node:22-alpine node --test 'tests/*.test.js'

.PHONY: serve
serve: ## Run the container locally on :8080 (was `make test` — that name now runs the SUITE)
	@echo '$(BLUE)Running $(PROJECT_NAME) locally on port 8080...$(NC)'
	@docker run --rm -d \
		--name $(PROJECT_NAME)-serve \
		-p 8080:8080 \
		luxardolabs/$(PROJECT_NAME):local
	@echo '$(GREEN)Container running. Access at http://localhost:8080$(NC)'
	@echo 'Stop with: docker stop $(PROJECT_NAME)-serve'

.PHONY: test-compose
test-compose: ## Test with docker compose
	@echo '$(BLUE)Starting $(PROJECT_NAME) with docker compose...$(NC)'
	@docker compose up -d
	@echo '$(GREEN)Services started. Access at http://localhost:8080$(NC)'
	@echo 'Stop with: make stop-compose'

.PHONY: stop-compose
stop-compose: ## Stop docker compose services
	@docker compose down

.PHONY: clean
clean: ## Remove local images and containers
	@echo '$(BLUE)Cleaning up...$(NC)'
	@docker compose down 2>/dev/null || true
	@docker stop $(PROJECT_NAME)-test 2>/dev/null || true
	@docker rm $(PROJECT_NAME)-test 2>/dev/null || true
	@docker rmi luxardolabs/$(PROJECT_NAME):local 2>/dev/null || true
	@docker rmi $(LOCAL_IMAGE):$(VERSION) 2>/dev/null || true
	@echo '$(GREEN)Cleanup complete$(NC)'

.PHONY: deploy-local
deploy-local: ## Deploy to local environment
	@echo '$(BLUE)Deploying to local environment...$(NC)'
	@docker network create luxardolabs 2>/dev/null || true
	@docker compose -f compose.yml up -d
	@echo '$(GREEN)Local deployment complete$(NC)'

.PHONY: scan
scan: docker-build-local ## Security scan the image
	@echo '$(BLUE)Scanning luxardolabs/$(PROJECT_NAME):local for vulnerabilities...$(NC)'
	@docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
		aquasec/trivy image luxardolabs/$(PROJECT_NAME):local

.PHONY: info
info: validate-version ## Show project information
	@echo '$(BLUE)Project Information:$(NC)'
	@echo '  Name: $(PROJECT_NAME)'
	@echo '  Version: $(VERSION)'
	@echo '  Directory: $(CURRENT_DIR)'
	@echo '  Build Date: $(BUILD_DATE)'
	@echo '  Platform: $(PLATFORM)'
	@echo ''
	@echo '$(BLUE)Registry Information:$(NC)'
	@echo '  Local: $(LOCAL_IMAGE)'
	@echo '  Docker Hub: $(DOCKER_HUB_IMAGE)'
	@echo '  GHCR: $(GHCR_IMAGE)'

# Development helpers
.PHONY: dev
dev: ## Start development environment (Python HTTP server)
	@echo '$(BLUE)Starting development server on port 8000...$(NC)'
	@python3 -m http.server 8000 2>/dev/null || python -m SimpleHTTPServer 8000

.PHONY: shell
shell: ## Open shell in running container
	@docker exec -it $(PROJECT_NAME)-test sh

.PHONY: logs
logs: ## Show container logs
	@docker logs -f $(PROJECT_NAME)-test


# ---------------------------------------------------------------------------------------------
# Fleet guards — luxarch (architecture), luxlint (ruff/mypy/eslint), luxaudit (dependency CVEs).
# All mount-only: they read the repo, never write to it. `make check` is the ONE gate.
#
# Reds stay RED. The fleet does not gate CI on a red — a red is fixed by aligning the code or by
# escalating a genuinely-wrong guard to the maintainer, never by routing around it.
# ---------------------------------------------------------------------------------------------

.PHONY: require-registry
require-registry: ## Fail with the remedy when site-local topology is absent
	@if [ -z "$(LUX_REGISTRY)" ]; then \
	  echo '$(RED)LUX_REGISTRY is unset — copy Makefile.local.example to Makefile.local and set it.$(NC)'; \
	  echo 'The registry host is site-local topology, deliberately not committed (this repo is public).'; \
	  exit 1; \
	fi

.PHONY: guard-version-check
guard-version-check: require-registry ## FAIL if any guard pin is behind the published latest
	@# Fatal, not warn-only: an agent working off a stale guard gets advice the current rules would
	@# have contradicted. `make guard-upgrade` clears it.
	@fail=0; \
	for g in luxarch luxlint luxaudit; do \
	  case $$g in \
	    luxarch)  pin='$(LUXARCH_VERSION)';;  \
	    luxlint)  pin='$(LUXLINT_VERSION)';;  \
	    luxaudit) pin='$(LUXAUDIT_VERSION)';; \
	  esac; \
	  docker pull -q $(LUX_REGISTRY)/luxardolabs/$$g:latest >/dev/null 2>&1 || true; \
	  latest=$$(docker run --rm --entrypoint sh $(LUX_REGISTRY)/luxardolabs/$$g:latest -c 'cat /opt/*/VERSION 2>/dev/null || true' 2>/dev/null | tr -d " \n"); \
	  [ -z "$$latest" ] && latest=$$(docker run --rm $(LUX_REGISTRY)/luxardolabs/$$g:latest --version 2>/dev/null | awk "{print \$$2}" | tr -d " \n"); \
	  if [ -n "$$latest" ] && [ "$$pin" != "$$latest" ]; then \
	    echo "$(RED)✗ $$g pinned $$pin, latest $$latest — BEHIND; run 'make guard-upgrade'$(NC)"; fail=1; \
	  else \
	    echo "$(GREEN)✓ $$g $$pin is current$(NC)"; \
	  fi; \
	done; \
	exit $$fail

.PHONY: guard-upgrade
guard-upgrade: ## Bump every guard pin to the published latest
	@for g in LUXARCH LUXLINT LUXAUDIT; do \
	  lc=$$(echo $$g | tr "[:upper:]" "[:lower:]"); \
	  docker pull -q $(LUX_REGISTRY)/luxardolabs/$$lc:latest >/dev/null 2>&1 || true; \
	  latest=$$(docker run --rm $(LUX_REGISTRY)/luxardolabs/$$lc:latest --version 2>/dev/null | awk "{print \$$2}" | tr -d " \n"); \
	  if [ -n "$$latest" ]; then \
	    sed -i -E "s|^($${g}_VERSION[[:space:]]*:?=[[:space:]]*).*|\\1$$latest|" Makefile; \
	    echo "$$lc -> $$latest"; \
	  else \
	    echo "$(RED)could not resolve latest for $$lc$(NC)"; exit 1; \
	  fi; \
	done; \
	echo "pins bumped — re-run make check"

.PHONY: honest
honest: ## Prove no luxarch rule family scanned ZERO files (the anti-hollow-green step)
	@# Fails ONLY when a rule family inspected nothing — never on reds. Without it a green board can
	@# hide a blind guard family.
	docker run --rm -v $(PWD):/repo $(LUXARCH_IMAGE) --assert-scans

.PHONY: lint
lint: ## luxlint — eslint over src/js + markdown + secret/test checks (no Python in this repo)
	docker run --rm -v $(PWD):/repo $(LUXLINT_IMAGE)

.PHONY: format
format: ## Apply every canonical formatter IN PLACE (the canonical fixer — never a bare ruff/mdformat)
	docker run --rm -v $(PWD):/repo $(LUXLINT_IMAGE) --format

.PHONY: arch
arch: ## luxarch — architecture conformance (static-web kind; reads .luxarch.toml)
	docker run --rm -v $(PWD):/repo $(LUXARCH_IMAGE)

.PHONY: audit
audit: ## luxaudit — dependency CVEs. luxmark's deps are CDN tags, so expect 0 packages; see .luxaudit.toml
	docker run --rm -v $(PWD):/repo $(LUXAUDIT_IMAGE)

.PHONY: gitleaks
gitleaks: ## Scan git HISTORY for secrets with the fleet denylist
	@docker run --rm -v $(PWD):/repo $(LUXLINT_IMAGE) --emit-config gitleaks > .gitleaks.toml
	docker run --rm -v $(PWD):/repo -w /repo zricethezav/gitleaks:latest git -c /repo/.gitleaks.toml --redact --verbose
	@rm -f .gitleaks.toml

.PHONY: check
check: guard-version-check honest lint test arch audit gitleaks ## THE gate — every wired guard
	@echo '$(GREEN)All checks passed!$(NC)'

.PHONY: status
status: ## Write the committed guard-status files the fleet audit reads
	@docker run --rm -v $(PWD):/repo $(LUXARCH_IMAGE) --json > .luxarch-status.json 2>/dev/null || true
	@docker run --rm -v $(PWD):/repo $(LUXLINT_IMAGE) --json > .luxlint-status.json 2>/dev/null || true
	@docker run --rm -v $(PWD):/repo $(LUXAUDIT_IMAGE) --json > .luxaudit-status.json 2>/dev/null || true
	@echo '$(GREEN)status files written — commit them$(NC)'

.PHONY: gh-release
gh-release: ## Publish a GitHub Release for $(VERSION) from its release notes (idempotent)
	@# A tag + a pushed image is not a Release: the /releases page is where a user looks for what
	@# changed. Reads the committed notes so the page and the repo cannot disagree.
	@notes="src/release_notes/$(VERSION).md"; \
	if [ ! -f "$$notes" ]; then \
	  echo '$(RED)missing '"$$notes"' — write the notes before releasing$(NC)'; exit 1; \
	fi; \
	if gh release view "v$(VERSION)" >/dev/null 2>&1; then \
	  echo '$(YELLOW)release v$(VERSION) exists — updating notes$(NC)'; \
	  gh release edit "v$(VERSION)" --notes-file "$$notes"; \
	else \
	  gh release create "v$(VERSION)" --title "LuxMark $(VERSION)" --notes-file "$$notes"; \
	fi

.PHONY: gitleaks-staged
gitleaks-staged: ## Pre-commit secret scan of STAGED changes (invoked by hooks/pre-commit)
	@docker run --rm -v $(PWD):/repo $(LUXLINT_IMAGE) --emit-config gitleaks > /tmp/luxmark.gl.toml; \
	docker run --rm -v $(PWD):/repo -v /tmp/luxmark.gl.toml:/gl.toml:ro -w /repo \
	  ghcr.io/gitleaks/gitleaks:latest protect --staged /repo -c /gl.toml --redact -v

.PHONY: githooks
githooks: ## Point git at the COMMITTED hooks (run once per clone)
	git config core.hooksPath hooks
	@echo '$(GREEN)core.hooksPath -> hooks/$(NC)'
