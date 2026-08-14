# actions-runner-claude — self-hosted runner image for the PR-review panel.
#
# Base: the official ARC runner container `ghcr.io/actions/actions-runner` (Ubuntu 24.04 noble +
#   .NET + runner agent). ECR pull-through cache (prefix `ghcr`) can be switched to via build-arg
#   once the rule is enabled. Previously FROM was .../actions-runner-claude:latest — the same
#   repo:tag as the push target — so the weekly cron build recursively stacked on top of its own
#   output, causing bloat and a base that never actually updated. Now FROM is the upstream
#   official image, so there's no recursion, and the runner agent/OS/.NET are delegated to
#   upstream (not configured directly here).
#
# Included in base: sudo, git, curl, jq, unzip, docker CLI, runner user (uid 1001, /home/runner,
#   run.sh).
# NOT included in base (installed here): gh, aws-cli v2, node, claude-code, codex, kiro-cli,
#   Claude Code plugins.
#
# Needs verification (after build): ECR PTC (ghcr) rule/credentials, gha-ecr-push role's
#   ghcr/actions/* import + actions-runner-claude push permission, `kiro-cli chat` flags
#   (no --v3, ADR-011).
ARG ECR_BASE=ghcr.io/actions/actions-runner:latest
FROM ${ECR_BASE}

# All tools are installed at the vendor's latest (no version/SHA pin) — the point of a weekly
# build is staying current, so pinning would be a design contradiction.
ARG NODE_MAJOR=24
ARG TARGETARCH=arm64

USER root

# 0) bubblewrap — required for the codex sandbox (falls back to a bundled version + warning if
#    missing). apt is available in the base image (Ubuntu noble).
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap \
 && rm -rf /var/lib/apt/lists/* \
 && bwrap --version

# 1) GitHub CLI (gh) — used by the pr-review workflow to fetch diffs/upsert comments. curl/unzip
#    already exist in the base. Installs the latest release.
RUN GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '\"tag_name\":\s*\"v\K[^\"]+')" \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/gh.tar.gz \
 && tar -xzf /tmp/gh.tar.gz -C /tmp \
 && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh* \
 && gh --version

# 2) AWS CLI v2 — for Bedrock/ECR (uses the runner node's IAM credentials).
# Only the unversioned latest URL is reliably available -> no SHA pin possible (would go stale
# each release). Installs latest.
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip \
 && aws --version

# 3) Node.js — required by the codex plugin companion (codex-companion.mjs, used for build-time
#    configure and the interactive `/codex:*` slash commands). Installs the latest patch of the
#    current stable LTS line (currently v24).
# NOTE: the base image (actions-runner, Ubuntu noble) doesn't have xz -> fetch as .tar.gz (gzip,
#    included by default) instead.
RUN NODE_TARBALL="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" | grep -oP "node-v[0-9.]+-linux-${TARGETARCH}\.tar\.gz" | head -1)" \
 && curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${NODE_TARBALL}" -o /tmp/node.tar.gz \
 && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.gz \
 && node --version

# Add ~/.local/bin (where the panel CLIs get installed) to PATH, so `command -v` can find them
# in the GHA step shell.
ENV PATH="/home/runner/.local/bin:${PATH}"

USER runner
WORKDIR /home/runner

# 4) claude-code — official native install (~/.local/bin, no npm needed). Used by the chair
#    (synthesize.sh) via `claude -p`.
# install.sh is an unversioned latest script -> no SHA pin possible (would go stale on every
# vendor update). Installs the latest claude.
RUN curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh \
 && bash /tmp/claude-install.sh \
 && rm /tmp/claude-install.sh \
 && claude --version

# 5) Codex — native Bedrock (config.toml). Official standalone install (~/.local/bin).
# install.sh is an unversioned latest script -> no SHA pin possible (would go stale on every
# vendor update). Installs the latest codex.
RUN curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/codex-install.sh \
 && CODEX_NON_INTERACTIVE=1 sh /tmp/codex-install.sh \
 && rm /tmp/codex-install.sh \
 && codex --version

# 6) Kiro CLI — the binary is named exactly `kiro-cli`. Installs the ARM64 zip from the
#    stable/latest channel (latest).
# `--v3` routes to a narrower model catalog that rejected gpt-5.5 (ADR-011) — gpt-5.6-terra
# (ADR-013) is assumed to hit the same catalog constraint (not re-verified). run-panel.sh calls
# `kiro-cli chat` (without v3), so the actual flags used are verified at build time.
RUN test "$TARGETARCH" = "arm64" \
 && curl -fsSL "https://prod.download.cli.kiro.dev/stable/latest/kirocli-aarch64-linux.zip" -o /tmp/kirocli.zip \
 && unzip -q /tmp/kirocli.zip -d /tmp/kirocli \
 && KIRO_CLI_SKIP_SETUP=1 /tmp/kirocli/kirocli/install.sh \
 && rm -rf /tmp/kirocli /tmp/kirocli.zip \
 && kiro-cli --version \
 && kiro-cli chat --help > /tmp/kiro-chat-help \
 && grep -F -- "--mode" /tmp/kiro-chat-help \
 && grep -F -- "--no-interactive" /tmp/kiro-chat-help \
 && grep -F -- "--wrap" /tmp/kiro-chat-help \
 # Checking only that the flags exist would still pass even if the "empty value = no tools"
 # semantics changed (kiro-cli auto-rebuilds weekly on stable/latest) — run-panel.sh's
 # fail-closed assumption (panel review round 15 M1, AWS-Demo-Platform PR#63 review L3-1) could
 # be silently defeated with no signal. So we verify the exact documented semantics wording too,
 # and fail the build itself if the wording changes (fail-closed).
 && grep -F -- "trust no tools: '--trust-tools='" /tmp/kiro-chat-help \
 && rm /tmp/kiro-chat-help

# 7) Baking the Codex Bedrock config (us-east-1, openai.gpt-5.6-sol). Uses the runner node's IAM
#    credentials.
COPY --chown=runner:runner config.toml /home/runner/.codex/config.toml

# 8) Baking the Claude Code plugins — installed as USER runner (HOME=/home/runner) so they
#    persist under ~/.claude. Available to every `claude` invocation on the runner.
RUN claude plugin marketplace add openai/codex-plugin-cc \
 && claude plugin marketplace add anthropics/claude-plugins-official \
 && claude plugin install codex@openai-codex \
 && claude plugin install code-review@claude-plugins-official \
 && claude plugin install github@claude-plugins-official \
 && claude plugin list

# 9) Configuring the codex plugin (equivalent to "codex:setup") — codex binary is installed +
#    native Bedrock (no codex login needed). Disables the stop-time review gate via companion
#    setup (an interactive feature unrelated to the headless panel) -> the image ships already
#    configured, with no first-run setup needed. Best-effort.
RUN CODEX_PLUGIN="$(find /home/runner/.claude -type d -path '*plugins*/codex' | head -1)" \
 && if [ -n "$CODEX_PLUGIN" ]; then \
        node "$CODEX_PLUGIN/scripts/codex-companion.mjs" setup --json --disable-review-gate \
        || echo "[warn] codex plugin configure failed; plugin installed but unconfigured" >&2 ; \
    else echo "[warn] codex plugin configure skipped (plugin path not found)" >&2 ; fi
