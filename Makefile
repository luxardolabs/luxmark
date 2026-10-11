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
LUXARCH_VERSION  := 0.278.1
LUXLINT_VERSION  := 0.63.1
LUXAUDIT_VERSION := 0.13.2
LUXARCH_IMAGE    := $(LUX_REGISTRY)/luxardolabs/luxarch:$(LUXARCH_VERSION)
LUXLINT_IMAGE    := $(LUX_REGISTRY)/luxardolabs/luxlint:$(LUXLINT_VERSION)
LUXAUDIT_IMAGE   := $(LUX_REGISTRY)/luxardolabs/luxaudit:$(LUXAUDIT_VERSION)
# The names the emitted gitleaks and guard-upgrade assets read.
LUXLINT          := $(LUXLINT_IMAGE)
REGISTRY         := $(LUX_REGISTRY)

comma := ,

# Docker registry settings
LOCAL_REGISTRY ?= $(LUX_REGISTRY)
IMAGE_ORG := luxardolabs
GITHUB_USER := luxardolabs
LOCAL_IMAGE := $(LOCAL_REGISTRY)/$(IMAGE_ORG)/$(PROJECT_NAME)
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

.PHONY: buildx-setup
# luxarch:buildx-setup asset v2 - DO NOT edit this marker line; it is how repo.emitted_assets_current knows your copy is current. Re-emit with `luxarch --emit buildx-setup`.
BUILDX_BUILDER ?= luxardo-builder
buildx-setup:
	@mkdir -p $(HOME)/.docker
	@[ -f $(HOME)/.docker/buildkitd.toml ] || printf '[worker.oci]\n  gc = true\n  [[worker.oci.gcpolicy]]\n    keepBytes = "20GB"\n    all = true\n' > $(HOME)/.docker/buildkitd.toml
	@docker buildx inspect $(BUILDX_BUILDER) >/dev/null 2>&1 || \
	  docker buildx create --name $(BUILDX_BUILDER) --driver docker-container \
	    --buildkitd-config $(HOME)/.docker/buildkitd.toml --use
	@docker buildx use $(BUILDX_BUILDER)
	@strays=$$(docker buildx ls 2>/dev/null | awk '$$2=="docker-container"{print $$1}' \
	  | grep -v '^\\_' | sed 's/\*$$//' | grep -vxF "$(BUILDX_BUILDER)" | tr '\n' ' '); \
	if [ -n "$$strays" ] && [ -z "$(ALLOW_STRAY_BUILDERS)" ]; then \
	  echo "REFUSING: stray per-project buildx builders are running: $$strays"; \
	  echo "Remove them:  docker buildx rm $$strays"; \
	  exit 1; \
	fi

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
docker-build-local: validate-version buildx-setup docker-pull-cache ## Build Docker image (local load, amd64 only for fast iteration)
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
		-t luxardolabs/$(PROJECT_NAME):local \
		--load \
		.
	@echo '$(GREEN)Docker build complete!$(NC)'

.PHONY: build-local
build-local: ## Build for local architecture only (quick, no buildx)
	@echo '$(BLUE)Building luxardolabs/$(PROJECT_NAME):local for local architecture...$(NC)'
	@docker build \
		--tag luxardolabs/$(PROJECT_NAME):local \
		--build-arg BUILD_VERSION=$(VERSION) \
		--build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
		--build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
		.
	@echo '$(GREEN)Build complete!$(NC)'

# Publishing $(1):$(VERSION), the same way to every registry (local, GHCR) (FLEET-RELEASE-PROCESS). The gate runs in ONE
# shell with `set -e`, so no step can be skipped past (`make -i`, `.IGNORE`) and every failure stops it:
#   1. refuse a tree that is dirty, or whose status git cannot read (another uid's checkout: a failed
#      `git status` prints nothing, which must never read as clean);
#   2. refuse an existing :$(VERSION) (released tags are immutable; prod pins them), naming the
#      per-registry targets that resume an interrupted `make release`. Any lookup error other than
#      the registry's own not-found refuses (fails closed);
#   3. build + push the multi-arch candidate to the PRIVATE registry only, so an image the scan
#      rejects is never public, and pin it by DIGEST (the candidate tag is mutable);
#   4. scan EVERY platform of that digest, each pulled by its OWN manifest digest (pulling the shared
#      index digest per platform fails: "cannot overwrite digest"), refusing a missing platform, with
#      the pinned luxaudit reading this repo's .luxaudit.toml ($(CURDIR), not the caller's $(PWD));
#   5. point $(1):$(VERSION) at the scanned digest (imagetools copies across registries, same digest).
# $(1) destination image (no tag)   $(2) extra buildx cache flags
RESUME_HINT := make release-ghcr if GHCR is still missing it, then make docker-tag-latest-local
define publish_version
	@# The two refusals below also run INSIDE the gated shell further down, which is what holds under
	@# `make -i`; these lines are the same checks in the shape repo.deploy_tag_is_immutable reads.
	@if [ -n "$$(git status --porcelain)" ]; then \
	  echo "REFUSING: the working tree is dirty"; exit 1; \
	fi
	@if docker manifest inspect $(1):$(VERSION) >/dev/null 2>&1; then \
	  echo "REFUSING: $(1):$(VERSION) is already RELEASED. A released version is immutable; bump VERSION."; \
	  echo "If a multi-registry release stopped partway, publish only what is missing: $(RESUME_HINT)"; exit 1; \
	fi
	@set -e; cand='$(LOCAL_IMAGE):candidate-$(BUILD_COMMIT)'; \
	st=$$(git -c safe.directory='$(CURDIR)' -C '$(CURDIR)' status --porcelain) || { \
	  echo "REFUSING: git status failed, so a clean tree cannot be proven"; exit 1; }; \
	if [ -n "$$st" ]; then \
	  echo "REFUSING: the working tree is dirty, so $(1):$(VERSION) would not describe commit $(BUILD_COMMIT):"; \
	  echo "$$st" | sed 's/^/    /'; exit 1; \
	fi; \
	if out=$$(docker manifest inspect '$(1):$(VERSION)' 2>&1); then \
	  echo "REFUSING: $(1):$(VERSION) is already RELEASED. A released version is immutable; bump VERSION."; exit 1; \
	fi; \
	case "$$out" in *[Nn]"o such manifest"*|*"manifest unknown"*|*"not found"*) ;; \
	  *) echo "REFUSING: cannot verify $(1):$(VERSION) is unreleased: $$out"; exit 1 ;; esac; \
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker buildx build \
	  --platform $(PLATFORM) \
	  $(2) \
	  --build-arg BUILD_VERSION=$(VERSION) \
	  --build-arg BUILD_TIMESTAMP="$(BUILD_DATE)" \
	  --build-arg BUILD_COMMIT="$(BUILD_COMMIT)" \
	  --label "org.opencontainers.image.created=$(BUILD_DATE)" \
	  --label "org.opencontainers.image.version=$(VERSION)" \
	  --label "org.opencontainers.image.revision=$(BUILD_COMMIT)" \
	  --label "org.opencontainers.image.title=LuxMark" \
	  --label "org.opencontainers.image.description=A premium browser-based markdown editor with live preview" \
	  --label "org.opencontainers.image.url=https://github.com/luxardolabs/luxmark" \
	  --label "org.opencontainers.image.source=https://github.com/luxardolabs/luxmark" \
	  --label "org.opencontainers.image.authors=luxardolabs" \
	  -t "$$cand" --push '$(CURDIR)'; \
	repo='$(LOCAL_IMAGE)'; ref='$(LUXAUDIT_IMAGE)'; \
	index=$$(docker buildx imagetools inspect "$$cand" --format '{{json .Manifest.Digest}}' | tr -d '"'); \
	case "$$index" in sha256:*) ;; *) echo "REFUSING: could not read the index digest of $$cand"; exit 1 ;; esac; \
	plats=$$(docker buildx imagetools inspect "$$repo@$$index" --raw | python3 -c 'import json, sys; [print(m["platform"]["os"] + "/" + m["platform"]["architecture"], m["digest"]) for m in json.load(sys.stdin)["manifests"] if m.get("platform", {}).get("os", "unknown") != "unknown"]'); \
	for p in $$(echo '$(PLATFORM)' | tr ',' ' '); do \
	  echo "$$plats" | grep -q "^$$p " || { echo "REFUSING: $$repo@$$index has no $$p image"; exit 1; }; \
	done; \
	T=$$(mktemp); trap 'rm -f "$$T"; docker rmi $(PROJECT_NAME):release-scan >/dev/null 2>&1 || true' EXIT INT TERM; \
	echo "$$plats" | while read -r plat digest; do \
	  docker pull -q "$$repo@$$digest" >/dev/null; \
	  docker tag "$$repo@$$digest" $(PROJECT_NAME):release-scan; \
	  docker save $(PROJECT_NAME):release-scan -o "$$T"; chmod 644 "$$T"; \
	  [ -s "$$T" ] || { echo "REFUSING: docker save wrote an empty archive for $$plat"; exit 1; }; \
	  docker run --rm -v '$(CURDIR)':/repo -v luxaudit-cache:/root/.cache/trivy -v "$$T":/candidate.tar:ro \
	    "$$ref" --image-archive /candidate.tar --image-label "$$cand $$plat ($$digest)" || exit 1; \
	done; \
	docker buildx imagetools create -t '$(1):$(VERSION)' "$$repo@$$index"; \
	printf '$(GREEN)Pushed %s = %s (every platform scanned)$(NC)\n' '$(1):$(VERSION)' "$$repo@$$index"
endef

.PHONY: docker-push-local
docker-push-local: validate-version require-registry buildx-setup docker-pull-cache ## Build, scan and push to local registry (multi-arch: amd64 + arm64)
	$(call publish_version,$(LOCAL_IMAGE),--build-arg BUILDKIT_INLINE_CACHE=1 --cache-from $(LOCAL_IMAGE):latest)

.PHONY: docker-push-ghcr
docker-push-ghcr: validate-version require-registry buildx-setup ## Build, scan and push to GHCR (multi-arch: amd64 + arm64; uses host docker login)
	$(call publish_version,$(GHCR_IMAGE),--cache-from type=registry$(comma)ref=$(GHCR_IMAGE):cache --cache-to type=registry$(comma)ref=$(GHCR_IMAGE):cache$(comma)mode=max)

.PHONY: docker-push-all
docker-push-all: docker-push-local docker-push-ghcr ## Push to all registries (local, GHCR)

.PHONY: docker-tag-latest-local
docker-tag-latest-local: require-registry ## Point local :latest at the EXISTING :$(VERSION) manifest
	@# `docker tag` + `docker push` publishes only the LOCAL architecture, so :latest would have
	@# silently lost linux/arm64 while :$(VERSION) kept it — an arm64 host pulling :latest would fail
	@# or get an emulated amd64 image, with nothing saying so. imagetools points the tag at the same
	@# multi-arch manifest.
	@echo '$(BLUE)Pointing local :latest at $(VERSION)...$(NC)'
	docker buildx imagetools create -t $(LOCAL_IMAGE):latest $(LOCAL_IMAGE):$(VERSION)
	@echo '$(GREEN)local :latest -> $(VERSION)$(NC)'

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
docker-tag-latest: docker-tag-latest-local docker-tag-latest-ghcr ## Tag as latest in all registries

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
	@echo '  $(YELLOW)GHCR:$(NC)'
	@echo '    $(GHCR_IMAGE):$(VERSION)'
	@echo '    $(GHCR_IMAGE):latest'
	@echo ''
	@echo '$(BLUE)Pull commands:$(NC)'
	@echo '  docker pull $(GHCR_IMAGE):latest'

.PHONY: test
test: ## Run the test suite (node:test, in docker — no npm install, no build step)
	@echo '$(BLUE)Running the luxmark test suite...$(NC)'
	docker run --rm -v $(PWD):/w -w /w node:22 node --test 'tests/*.test.js'

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

# =============================================================================
# Production — the OVH node ($(PROD_NODE)) reached via the jump host ($(PROD_JUMP)), the same box
# and the same shape as www and luxof.life. The node PULLS the public GHCR image at :$(VERSION);
# compose never builds. TLS and routing come from the edge nginx-ovh, which proxies
# luxmark.luxardolabs.com to http://luxmark:8080 (hence the service/container name in compose.yml).
# The node topology lives in the gitignored Makefile.local (this repo is public). After a release:
#   make release-ghcr   # build + scan every platform + promote :$(VERSION) (and :latest) on GHCR
#   make gh-release     # the GitHub Release
#   make prod-deploy    # sync compose.yml, pin .env to :$(VERSION), pull + recreate, verify the live site
# Roll back by deploying an older released version: make prod-deploy MANUAL_VERSION=<x.y.z>
# =============================================================================
PROD_URL     ?= https://luxmark.luxardolabs.com
# The node trusts only the jump host's key (no ProxyJump), so commands cross TWO ssh hops. Each hop's
# shell would re-parse a command line (`a; b` ran `b` on the jump host), so every remote step is a
# script on STDIN to `sh -s`, which passes both hops untouched.
PROD_SH       = ssh -o BatchMode=yes $(PROD_JUMP) ssh -o BatchMode=yes root@$(PROD_NODE) sh -s
# -f is explicit: never let compose auto-pick (a compose.yaml beside compose.yml silently wins).
PROD_COMPOSE := docker compose -f compose.yml
PROD_WAIT    ?= 90

.PHONY: require-prod prod-sync prod-deploy prod-ps prod-logs prod-health
require-prod: ## Fail with the remedy when the prod node topology (Makefile.local) is absent
	@if [ -z "$(PROD_JUMP)" ] || [ -z "$(PROD_NODE)" ] || [ -z "$(PROD_DIR)" ]; then \
	  echo '$(RED)PROD_JUMP / PROD_NODE / PROD_DIR unset: set them in Makefile.local (see Makefile.local.example).$(NC)'; \
	  exit 1; \
	fi

prod-sync: require-prod ## Push compose.yml to the node (the repo is the source of truth)
	@# A hand-placed compose.yaml predates the synced compose.yml: kept beside it, renamed, never deleted.
	@printf '%s\n' 'set -e; mkdir -p $(PROD_DIR); cd $(PROD_DIR)' \
	  "echo $$(base64 -w0 compose.yml) | base64 -d > compose.yml.new && mv compose.yml.new compose.yml" \
	  'if [ -f compose.yaml ]; then mv compose.yaml compose.yaml.pre-compose-yml; echo "renamed the old compose.yaml to compose.yaml.pre-compose-yml"; fi' \
	  'sha256sum compose.yml' | $(PROD_SH)
	@echo "local: $$(sha256sum compose.yml)"
	@echo '$(GREEN)synced compose.yml to $(PROD_NODE):$(PROD_DIR)$(NC)'

prod-deploy: require-prod prod-sync ## Pin the node to :$(VERSION), pull, recreate, wait healthy, verify the live site
	@out=$$(docker manifest inspect $(GHCR_IMAGE):$(VERSION) 2>&1) || { \
	  echo '$(RED)REFUSING: $(GHCR_IMAGE):$(VERSION) is not published (run the release first): '"$$out"'$(NC)'; exit 1; }
	@echo '$(BLUE)Deploying $(GHCR_IMAGE):$(VERSION) to $(PROD_NODE):$(PROD_DIR)...$(NC)'
	@printf '%s\n' 'set -e; cd $(PROD_DIR)' 'printf "TAG=%s\n" "$(VERSION)" > .env' \
	  '$(PROD_COMPOSE) pull' '$(PROD_COMPOSE) up -d --wait --wait-timeout $(PROD_WAIT)' \
	  'docker inspect -f "{{.Name}} {{.State.Health.Status}} {{.Config.Image}}" luxmark-web' | $(PROD_SH)
	@got=$$(curl -fsS --max-time 10 $(PROD_URL)/version.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["version"], d["commit"])'); \
	case "$$got" in "$(VERSION) "*) echo '$(GREEN)live: $(PROD_URL) serves '"$$got"'$(NC)';; \
	  *) echo '$(RED)DEPLOY NOT LIVE: $(PROD_URL)/version.json reports "'"$$got"'", expected $(VERSION)$(NC)'; exit 1;; esac

prod-ps: require-prod ## Prod stack status (on the node)
	@printf '%s\n' 'cd $(PROD_DIR) && $(PROD_COMPOSE) ps' | $(PROD_SH)

prod-logs: require-prod ## Tail prod logs (on the node; Ctrl-C to stop)
	ssh -t $(PROD_JUMP) "ssh -t root@$(PROD_NODE) 'cd $(PROD_DIR) && $(PROD_COMPOSE) logs -f --tail 100'"

prod-health: require-prod ## The container's own healthcheck plus what the live site serves
	@printf '%s\n' 'docker inspect -f "luxmark-web: {{.State.Status}} {{.State.Health.Status}} {{.Config.Image}}" luxmark-web' | $(PROD_SH)
	@curl -fsS --max-time 10 $(PROD_URL)/version.json && echo

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
# luxarch:guard-upgrade asset v1 - DO NOT edit this marker line; it is how repo.emitted_assets_current knows your copy is current. Re-emit with `luxarch --emit guard-upgrade`.
guard-upgrade:  ## Bump every guard pin to the published latest (prints what newly bites)
	@for g in luxarch luxlint luxaudit; do \
	  docker pull -q $(REGISTRY)/luxardolabs/$$g:latest >/dev/null 2>&1 || true; \
	  latest=$$(docker run --rm $(REGISTRY)/luxardolabs/$$g:latest --version 2>/dev/null | awk '{print $$2}'); \
	  var=$$(echo $$g | tr a-z A-Z)_VERSION; \
	  old=$$(sed -n -E "s/^$$var[[:space:]]*:=[[:space:]]*//p" Makefile); \
	  if [ -z "$$old" ]; then echo "!! no $$var pin found in Makefile — NOT bumped"; continue; fi; \
	  if [ -z "$$latest" ]; then echo "!! could not read $$g:latest — $$var left at $$old"; continue; fi; \
	  checked=1; \
	  sed -i -E "s|^($$var[[:space:]]*:=[[:space:]]*).*|\\1$$latest|" Makefile; \
	  new=$$(sed -n -E "s/^$$var[[:space:]]*:=[[:space:]]*//p" Makefile); \
	  if [ "$$new" != "$$latest" ]; then echo "!! $$var did NOT change (still $$new)"; exit 1; fi; \
	  if [ "$$old" != "$$latest" ]; then echo "$$var $$old -> $$latest"; bumped=1; fi; \
	  [ "$$g" = luxarch ] && [ "$$old" != "$$latest" ] && docker run --rm -v $(PWD):/repo $(REGISTRY)/luxardolabs/luxarch:$$latest --new-rules --since $$old || true; \
	done; \
	if [ -n "$$bumped" ]; then echo "pins bumped — re-run make check"; \
	elif [ -n "$$checked" ]; then echo "all pins already at latest"; \
	else echo "!! could not reach the registry — NO pin was checked; currency NOT established"; exit 1; fi

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

.PHONY: gitleaks gitleaks-staged
# luxarch:gitleaks asset v12 - DO NOT edit this marker line; it is how repo.emitted_assets_current knows your copy is current. Re-emit with `luxarch --emit gitleaks`.
# ── The privacy gate: BOTH surfaces ─────────────────────────────────────────────────────────────
# Emitted by `luxarch --emit gitleaks`. Drop in verbatim.
#
# `gitleaks` scans DIFF CONTENT. A commit's author/committer address lives in the commit object
# HEADER and never appears in a patch, so no content rule can ever match it — it is a surface the
# scanner does not read. A repo reported `no leaks found` over 963 commits while 29 of them carried a
# personal address in both the author and committer fields, and it would have reported exactly the
# same thing after the scrub: identical output, opposite truth. Measured across the fleet, EIGHT
# repos carry a personal address in history and two of them are PUBLIC.

# Commit identities this repo accepts. The fleet account's `users.noreply.github.com` address, plus
# GitHub's own web-UI committer. Widen ONLY for a real outside contributor, with a comment saying who.
# NOT for the org account's real address: a role mailbox in commit metadata is published with every
# clone exactly like a personal one (six fleet repos carried it, one PUBLIC). Its
# omission here is the policy, not an oversight: the answer is the scrub printed below, and the
# repo's agent performs it once the OWNER approves the force-push.
# Anchored on the CLOSING BRACKET, because the compared line is `Name <email>` — not a bare
# address. The first cut allowed `^noreply@github.com$$`, which can NEVER match a
# `Name <email>` line, so the GitHub web-UI identity was silently DENIED and the canonical
# recipe would have refused on any repo carrying a web-UI commit. Measured across the fleet: it
# denied 4 of 6 distinct identity lines instead of the 3 real offenders.
# It was missed because the only repo it was tested on has no web-UI commits, so the broken
# branch never ran. The bracket also closes a substring hole: unanchored,
# `<x@users.noreply.github.com.attacker.test>` would have been allowed.
# v11: the noreply address is `<local@users.noreply.github.com>`, and the local part has no `@`. v10's
# `<[^>]*users…` admitted `<dev.real@gmail.com.users.noreply.github.com>`, a real address in the clear.
# v12: the fleet ACCOUNT, not any noreply address. v11 accepted `<anyone@users.noreply.github.com>`, so a
# stranger's (or a second account's) noreply committer passed. Measured: the fleet's whole history holds
# exactly two noreply identities, the fleet account and GitHub's web-UI committer.
GIT_IDENTITY_OK ?= <214140984\+luxardolabs@users\.noreply\.github\.com>$$|<noreply@github\.com>$$

# The secret scanner, PINNED and MIRRORED in the fleet registry. The fleet bans a moving tag
# everywhere it can see one, and this used to ship `ghcr.io/gitleaks/gitleaks:latest` inside the asset every
# repo adopts verbatim: the privacy gate could not run with ghcr unreachable or the local copy pruned, and
# nothing recorded which scanner said "no leaks found". New detection rules still arrive, through the fleet's
# own mechanism: luxarch bumps this pin in a release, and `repo.emitted_assets_current` tells you to re-emit.
# v5: the HOST is never written here. v4 inlined the private registry, so dropping
# this asset in "verbatim" put the host into a committed Makefile, and on a public repo the fleet's
# own gitleaks disclosure tier refused the commit. The mirror lives beside the guards, so the ref is
# derived from wherever this repo already pulls luxlint (`$(LUXLINT)`, which the scan below needs
# anyway). It works whichever variable holds your guard registry (REGISTRY, LUXARCH_REGISTRY, …).
# Recursive `=` so it resolves at use, whatever order LUXLINT is defined in.
# v9: PINNED BY DIGEST, and buildable off-network. The digest is the scanner's identity; the registry is
# only where it is fetched from. Beside a registry-qualified `$(LUXLINT)` it pulls the fleet mirror; with
# a local guard build (`luxlint:local`, on a machine with no access to the fleet registry, such as an
# airgapped laptop) it pulls the public image. v8 derived `./gitleaks:…` there, an unpullable reference, so the
# privacy gate could not run at all. The mirror and the public image share the digest, so both
# resolve to the same bits, and a tampered or re-tagged copy fails the pull instead of scanning.
GITLEAKS_IMAGE = $(if $(findstring /,$(LUXLINT)),$(dir $(LUXLINT)),zricethezav/)gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f

gitleaks: ## secret scan over FULL HISTORY + the commit-identity pass (the hooks cover commit/push)
	@set -e; C=$$(mktemp); trap 'rm -f "$$C"' EXIT INT TERM; \
	docker run --rm -v $(PWD):/repo $(LUXLINT) --emit-config gitleaks > "$$C"; \
	docker run --rm -v $(PWD):/repo -v "$$C":/gl.toml:ro -w /repo \
	  $(GITLEAKS_IMAGE) git /repo -c /gl.toml --redact -v --ignore-gitleaks-allow
	@# v12: what `gitleaks git` never reads. It scans git's PATCHES, and git prints no patch for a file it
	@# treats as binary: a NUL byte, UTF-16 (a `Localizable.strings`), or a `binary` / `-diff` attribute.
	@# A token in any of them reached the remote with "no leaks found". So every path git ever showed as
	@# binary is re-read as text, NULs stripped, and scanned by path (the config's path allowlists hold).
	@set -e; C=$$(mktemp); D=$$(mktemp -d); trap 'rm -rf "$$C" "$$D"' EXIT INT TERM; \
	docker run --rm -v $(PWD):/repo $(LUXLINT) --emit-config gitleaks > "$$C"; \
	git -c core.quotePath=false log --branches --tags HEAD --format= -p --no-ext-diff --no-textconv \
	  > "$$D/patches"; \
	sed -n 's|^Binary files .* and b/\(.*\) differ$$|\1|p' "$$D/patches" | sort -u > "$$D/binary"; \
	if [ -s "$$D/binary" ]; then \
	  mkdir "$$D/t" "$$D/none"; \
	  while IFS= read -r f; do \
	    mkdir -p "$$D/t/$$(dirname "$$f")"; \
	    git -c core.quotePath=false log --branches --tags HEAD --format= -p --text --no-ext-diff \
	      --no-textconv -- "$$f" > "$$D/p"; \
	    grep -a '^+' "$$D/p" | tr -d '\000' > "$$D/t/$$f"; \
	  done < "$$D/binary"; \
	  docker run --rm -v "$$D/t":/scan:ro -w /scan -v "$$D/none":/none:ro -v "$$C":/gl.toml:ro \
	    $(GITLEAKS_IMAGE) dir . -c /gl.toml --redact -v --ignore-gitleaks-allow \
	    --gitleaks-ignore-path /none; \
	fi
	@# The identity pass — the half gitleaks structurally cannot do. Cheap: one `git log`.
	@# Walks what THIS repo publishes (branches, tags, HEAD), NOT `--all`: a remote-tracking ref caches the
	@# remote's state, which during a scrub is by definition the un-rewritten history you are about to
	@# force-push over — `--all` refused the verified fix, and any `git fetch` re-armed it.
	@bad=$$(git log --branches --tags HEAD --pretty='%an <%ae>%n%cn <%ce>' 2>/dev/null | sort -u \
	  | grep -vE '$(GIT_IDENTITY_OK)' || true); \
	if [ -n "$$bad" ]; then \
	  echo "REFUSING: a non-fleet identity appears in commit METADATA (author/committer):"; \
	  echo "$$bad" | sed 's/^/    /'; \
	  echo "gitleaks cannot see this — it scans diffs, not commit headers, so it reported no leaks."; \
	  echo "An address here is attached to every affected commit forever, not to one line of one file."; \
	  echo "Scrub per FLEET-ONBOARDING-STANDARD §2: mirror backup -> git filter-repo -> re-verify with"; \
	  echo "  git log --branches --tags HEAD --pretty='%an <%ae>%n%cn <%ce>' | sort -u"; \
	  echo "-> ask the OWNER to approve the force-push, then do it yourself. Never force-push unapproved."; \
	  exit 1; \
	fi

# v6: the STAGED scan the commit hook calls (`hooks/pre-commit` → `make gitleaks-staged`) is part of the
# asset now. v5 shipped only the full-history half, so 9 of 10 adopting repos hand-wrote this target
# and the tenth had none, leaving its pre-commit hook pointing at a missing recipe. If your Makefile
# carries its own `gitleaks-staged`, delete it when you re-emit: this one replaces it.
# v7: `-w /repo` is LOAD-BEARING. Without it git runs outside the repo, falls back to `git diff
# --no-index`, rejects `--staged`, and gitleaks EXITS 0: v6 let a staged secret through while printing
# a git error (measured on a planted GitHub token: v6 exit 0, v7 "leaks found: 1" exit 1).
# v8: the denylist goes to a PER-RUN `mktemp` file, removed on exit. v7 wrote a fixed
# `/tmp/gl.toml` that outlived the run: on a host where commit and push run as different users, the
# next user's redirect was refused (`fs.protected_regular=1`, the Fedora default, blocks O_CREAT on
# another user's file in sticky /tmp even for root), so the privacy gate failed every commit or push
# after a user switch (2 of 2 measured). Two repos scanning at once also shared one file, so one could
# scan with the other's carve-outs. The full-history scan now also passes `-w /repo`, like the staged one.
# v12: the staged bytes are read on the HOST and scanned as files, by path. v11 ran `protect --staged`
# inside the container, which read `.git/index`, not the temporary index git hands the hook in
# `$$GIT_INDEX_FILE`: `git commit -a` and `git commit <path>` were never scanned. It also read git's
# patches, which skip binary, NUL, UTF-16 and `-diff` files, and it honoured a `# gitleaks:allow` on
# the secret's own line and a committed `.gitleaksignore`, so a commit's author could waive their own
# leak. New content gets no waiver: `.gitleaksignore` stays a ledger for the full-history scan only.
gitleaks-staged: ## secret scan of the STAGED changes (run by hooks/pre-commit)
	@set -e; C=$$(mktemp); D=$$(mktemp -d); trap 'rm -rf "$$C" "$$D"' EXIT INT TERM; \
	docker run --rm -v $(PWD):/repo $(LUXLINT) --emit-config gitleaks > "$$C"; \
	mkdir "$$D/t" "$$D/none"; \
	git -c core.quotePath=false diff --cached --name-only --diff-filter=ACMR -z > "$$D/names"; \
	tr '\000' '\n' < "$$D/names" | while IFS= read -r f; do \
	  [ -n "$$f" ] || continue; \
	  mkdir -p "$$D/t/$$(dirname "$$f")"; \
	  git -c core.quotePath=false diff --cached --text --no-ext-diff --no-textconv -U0 -- "$$f" \
	    > "$$D/p"; \
	  grep -a '^+' "$$D/p" | tr -d '\000' > "$$D/t/$$f"; \
	done; \
	docker run --rm -v "$$D/t":/scan:ro -w /scan -v "$$D/none":/none:ro -v "$$C":/gl.toml:ro \
	  $(GITLEAKS_IMAGE) dir . -c /gl.toml --redact -v --ignore-gitleaks-allow \
	  --gitleaks-ignore-path /none

.PHONY: check
check: guard-version-check honest lint test arch audit gitleaks ## THE gate — every wired guard
	@echo '$(GREEN)All checks passed!$(NC)'

# Regenerate the committed guard-status files (the fleet reads these instead of re-running).
# STAMP refuses a document that is not the expected guard's own (`"guard"` in every --json), so a
# crossed or empty file can never be committed as this repo's record. See `luxarch --doc FLEET-STATUS`.
GUARD_RUN = docker run --rm -v $(PWD):/repo
STAMP = python3 -c 'import json,sys,os; d=json.load(open(sys.argv[1])); g=d.get("guard"); g==sys.argv[3] or sys.exit(f"status: {sys.argv[1]} holds {g!r} output, expected {sys.argv[3]!r}; refusing to stamp"); d["commit"]=os.environ["SHA"]; d["generated_at"]=os.environ["TS"]; json.dump(d,open(sys.argv[2],"w"),indent=2)'

# `set -e`: a failed stamp (empty, invalid or another guard's --json) ABORTS the recipe — never a
# false "wrote". `mktemp`: a per-run file, never a fixed /tmp path every repo on the host shares.
.PHONY: status
status: require-registry ## Regenerate committed guard-status files (.lux*-status.json) — commit them
	@set -e; export SHA=$$(git rev-parse HEAD) TS=$$(date -u +%FT%TZ); \
	J=$$(mktemp); trap 'rm -f "$$J"' EXIT INT TERM; \
	$(GUARD_RUN) $(LUXLINT_IMAGE)  --json > "$$J" || true; $(STAMP) "$$J" .luxlint-status.json luxlint; \
	$(GUARD_RUN) -e LUXARCH_STATUS_WRITE=1 $(LUXARCH_IMAGE) --json > "$$J" || true; $(STAMP) "$$J" .luxarch-status.json luxarch; \
	$(GUARD_RUN) $(LUXAUDIT_IMAGE) --json > "$$J" || true; $(STAMP) "$$J" .luxaudit-status.json luxaudit; \
	echo "wrote .lux*-status.json at $$SHA — commit them"

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

.PHONY: githooks
githooks: ## Point git at the COMMITTED hooks (run once per clone)
	git config core.hooksPath hooks
	@echo '$(GREEN)core.hooksPath -> hooks/$(NC)'
