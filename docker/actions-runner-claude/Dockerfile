# actions-runner-claude — PR-review 패널 self-hosted 러너 이미지.
#
# 베이스: 공식 ARC 러너 컨테이너 `ghcr.io/actions/actions-runner` (Ubuntu 24.04 noble + .NET +
#   runner agent), **ECR pull-through cache(prefix `ghcr`) 경유**로 가져온다.
#   이전엔 FROM .../actions-runner-claude:latest = push 대상과 동일 repo:tag 라서, 주간 cron 빌드가
#   자기 출력 위에 재귀-스택돼 비대화·베이스 고정 문제가 있었다. 이제 FROM 이 upstream 공식 이미지라
#   재귀 없음 + runner agent/OS/.NET 은 upstream 에 위임(직접 구성하지 않음).
#
# 베이스 포함: sudo, git, curl, jq, unzip, docker CLI, runner 사용자(uid 1001, /home/runner, run.sh).
# 베이스 미포함(여기서 설치): gh, aws-cli v2, node, claude-code, codex, kiro-cli, Claude Code 플러그인.
#
# 검증 필요(빌드 후): ECR PTC(ghcr) 규칙/자격증명, gha-ecr-push 역할의 ghcr/* import + actions-runner-claude
#   push 권한, `kiro-cli --v3` 플래그.
ARG ECR_BASE=180294183052.dkr.ecr.ap-northeast-2.amazonaws.com/ghcr/actions/actions-runner:latest
FROM ${ECR_BASE}

ARG NODE_VERSION=20.18.1
ARG GH_VERSION=2.63.2
ARG TARGETARCH=arm64

USER root

# 1) GitHub CLI(gh) — pr-review 워크플로의 diff/코멘트 upsert. 베이스에 curl/unzip 존재.
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/gh.tar.gz \
 && tar -xzf /tmp/gh.tar.gz -C /tmp \
 && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh* \
 && gh --version

# 2) AWS CLI v2 — Bedrock/ECR (러너 노드 IAM 자격증명 사용).
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip \
 && aws --version

# 3) Node.js — codex 플러그인 companion(codex-companion.mjs, build-time configure 및 인터랙티브
#    `/codex:*` 슬래시 커맨드)이 요구. 공식 바이너리(결정적). claude-code 는 npm 미사용(아래 curl).
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${TARGETARCH}.tar.xz" -o /tmp/node.tar.xz \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && node --version

# 패널 CLI 가 설치되는 ~/.local/bin 을 PATH 에 추가 (GHA step 셸에서 command -v 가 찾도록).
ENV PATH="/home/runner/.local/bin:${PATH}"

USER runner
WORKDIR /home/runner

# 4) claude-code — 공식 네이티브 설치(~/.local/bin, npm 불필요). 의장(synthesize.sh)이 `claude -p` 로 사용.
RUN curl -fsSL https://claude.ai/install.sh | bash \
 && claude --version

# 5) Codex — Bedrock 네이티브(config.toml). 공식 standalone 설치(~/.local/bin).
RUN curl -fsSL https://chatgpt.com/codex/install.sh | sh \
 && codex --version

# 6) Kiro CLI — 바이너리명은 정확히 `kiro-cli`. 공식 설치 (KIRO_API_KEY 로 인증).
# 패널은 v3 하니스로 동작(run-panel.sh: `kiro-cli --v3 chat`) → v3 플래그 존재를 빌드 시 검증해
# 플래그 부재/리네임 시 주간 빌드가 조용히 깨지지 않고 즉시 실패하게 한다.
RUN curl -fsSL https://cli.kiro.dev/install | bash \
 && kiro-cli --version \
 && kiro-cli --v3 --help >/dev/null

# 7) Codex Bedrock 설정 baking (us-east-1, openai.gpt-5.5). 러너 노드 IAM 자격증명 사용.
COPY --chown=runner:runner config.toml /home/runner/.codex/config.toml

# 8) Claude Code 플러그인 베이킹 — USER runner(HOME=/home/runner)로 설치하여 ~/.claude 에 영속.
#    러너의 모든 `claude` 호출에서 사용 가능.
RUN claude plugin marketplace add openai/codex-plugin-cc \
 && claude plugin marketplace add anthropics/claude-plugins-official \
 && claude plugin install codex@openai-codex \
 && claude plugin install code-review@claude-plugins-official \
 && claude plugin install github@claude-plugins-official \
 && claude plugin list

# 9) codex 플러그인 구성("codex:setup" 상당) — codex 바이너리 설치됨 + Bedrock 네이티브
#    (codex login 불필요). companion setup 으로 stop-time 리뷰 게이트 비활성(헤드리스 패널과
#    무관한 인터랙티브 기능) → 이미지가 first-run setup 없이 구성 완료 상태로 출하. best-effort.
RUN CODEX_PLUGIN="$(find /home/runner/.claude -type d -path '*plugins*/codex' | head -1)" \
 && if [ -n "$CODEX_PLUGIN" ]; then \
        node "$CODEX_PLUGIN/scripts/codex-companion.mjs" setup --json --disable-review-gate \
        || echo "[warn] codex plugin configure failed; plugin installed but unconfigured" >&2 ; \
    else echo "[warn] codex plugin configure skipped (plugin path not found)" >&2 ; fi
