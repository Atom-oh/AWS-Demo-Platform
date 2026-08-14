# actions-runner-claude — self-hosted runner image for the PR-review panel.
#
# FROM must stay the upstream official image, not this repo's own :latest — a self-referencing
# FROM would recursively stack on every weekly cron build.
ARG ECR_BASE=ghcr.io/actions/actions-runner:latest
FROM ${ECR_BASE}

# All tools install at vendor-latest (no version/SHA pin) — weekly builds are meant to track
# upstream, so pinning would defeat the point.
ARG NODE_MAJOR=24
ARG TARGETARCH=arm64

USER root

# bubblewrap — required for the codex sandbox.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap \
 && rm -rf /var/lib/apt/lists/* \
 && bwrap --version

# GitHub CLI — used by pr-review workflow to fetch diffs/upsert comments.
RUN GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '\"tag_name\":\s*\"v\K[^\"]+')" \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/gh.tar.gz \
 && tar -xzf /tmp/gh.tar.gz -C /tmp \
 && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh* \
 && gh --version

# AWS CLI v2 — for Bedrock/ECR, using the runner node's IAM credentials.
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip \
 && aws --version

# Node.js — required by the codex plugin companion (codex-companion.mjs).
# Fetched as .tar.gz, not .tar.xz — the base image has no xz.
RUN NODE_TARBALL="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" | grep -oP "node-v[0-9.]+-linux-${TARGETARCH}\.tar\.gz" | head -1)" \
 && curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${NODE_TARBALL}" -o /tmp/node.tar.gz \
 && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.gz \
 && node --version

# Panel CLIs install to ~/.local/bin; put it on PATH so `command -v` finds them in GHA steps.
ENV PATH="/home/runner/.local/bin:${PATH}"

USER runner
WORKDIR /home/runner

# claude-code — used by the chair (synthesize.sh) via `claude -p`.
RUN curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh \
 && bash /tmp/claude-install.sh \
 && rm /tmp/claude-install.sh \
 && claude --version

# Codex — native Bedrock config (see config.toml below).
RUN curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/codex-install.sh \
 && CODEX_NON_INTERACTIVE=1 sh /tmp/codex-install.sh \
 && rm /tmp/codex-install.sh \
 && codex --version

# Kiro CLI. `--v3` routes to a narrower model catalog that rejected gpt-5.5 (ADR-011);
# run-panel.sh always calls `kiro-cli chat` without --v3.
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
 # Fail the build if this exact wording changes — kiro-cli auto-rebuilds weekly, and
 # run-panel.sh's fail-closed no-tools assumption depends on this semantics, not just flag
 # presence (PR#63 review L3-1).
 && grep -F -- "trust no tools: '--trust-tools='" /tmp/kiro-chat-help \
 && rm /tmp/kiro-chat-help

# Codex Bedrock config (us-east-1, openai.gpt-5.6-sol) via the runner node's IAM credentials.
COPY --chown=runner:runner config.toml /home/runner/.codex/config.toml

# Claude Code plugins, installed as USER runner so they persist under ~/.claude.
RUN claude plugin marketplace add openai/codex-plugin-cc \
 && claude plugin marketplace add anthropics/claude-plugins-official \
 && claude plugin install codex@openai-codex \
 && claude plugin install code-review@claude-plugins-official \
 && claude plugin install github@claude-plugins-official \
 && claude plugin list

# Disable the codex plugin's interactive stop-time review gate (irrelevant to the headless
# panel) so the image ships pre-configured. Best-effort.
RUN CODEX_PLUGIN="$(find /home/runner/.claude -type d -path '*plugins*/codex' | head -1)" \
 && if [ -n "$CODEX_PLUGIN" ]; then \
        node "$CODEX_PLUGIN/scripts/codex-companion.mjs" setup --json --disable-review-gate \
        || echo "[warn] codex plugin configure failed; plugin installed but unconfigured" >&2 ; \
    else echo "[warn] codex plugin configure skipped (plugin path not found)" >&2 ; fi
