# actions-runner-claude — PR-review 패널 self-hosted 러너 이미지.
#
# 베이스: 공식 ARC 러너 컨테이너 `ghcr.io/actions/actions-runner` (Ubuntu 24.04 noble + .NET +
#   runner agent). ECR pull-through cache(prefix `ghcr`)는 rule 활성화 후 build-arg로 전환 가능.
#   이전엔 FROM .../actions-runner-claude:latest = push 대상과 동일 repo:tag 라서, 주간 cron 빌드가
#   자기 출력 위에 재귀-스택돼 비대화·베이스 고정 문제가 있었다. 이제 FROM 이 upstream 공식 이미지라
#   재귀 없음 + runner agent/OS/.NET 은 upstream 에 위임(직접 구성하지 않음).
#
# 베이스 포함: sudo, git, curl, jq, unzip, docker CLI, runner 사용자(uid 1001, /home/runner, run.sh).
# 베이스 미포함(여기서 설치): gh, aws-cli v2, node, claude-code, codex, kiro-cli, Claude Code 플러그인.
#
# 검증 필요(빌드 후): ECR PTC(ghcr) 규칙/자격증명, gha-ecr-push 역할의 ghcr/actions/* import + actions-runner-claude
#   push 권한, `kiro-cli chat` 플래그(--v3 없음, ADR-011).
ARG ECR_BASE=ghcr.io/actions/actions-runner:latest
FROM ${ECR_BASE}

# 모든 도구는 벤더 latest 로 설치(버전·SHA 핀 없음). 주간 빌드의 목적이 최신 유지이므로 핀은 설계상 모순.
ARG NODE_MAJOR=24
ARG TARGETARCH=arm64

USER root

# 0) bubblewrap — codex sandbox 전제(없으면 번들 fallback + 경고). base(Ubuntu noble)에 apt 존재.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap \
 && rm -rf /var/lib/apt/lists/* \
 && bwrap --version

# 1) GitHub CLI(gh) — pr-review 워크플로의 diff/코멘트 upsert. 베이스에 curl/unzip 존재. latest 릴리스.
RUN GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '\"tag_name\":\s*\"v\K[^\"]+')" \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/gh.tar.gz \
 && tar -xzf /tmp/gh.tar.gz -C /tmp \
 && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
 && rm -rf /tmp/gh* \
 && gh --version

# 2) AWS CLI v2 — Bedrock/ECR (러너 노드 IAM 자격증명 사용).
# 버전 없는 latest URL 만 안정 제공 → SHA 핀 불가(릴리스마다 stale). latest 설치.
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip \
 && aws --version

# 3) Node.js — codex 플러그인 companion(codex-companion.mjs, build-time configure 및 인터랙티브
#    `/codex:*` 슬래시 커맨드)이 요구. stable 최신(현재 LTS 라인 v24)의 latest 패치를 설치.
# NOTE: base 이미지(actions-runner, Ubuntu noble)에는 xz 가 없다 → .tar.gz(gzip, 기본 포함)로 받는다.
RUN NODE_TARBALL="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" | grep -oP "node-v[0-9.]+-linux-${TARGETARCH}\.tar\.gz" | head -1)" \
 && curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${NODE_TARBALL}" -o /tmp/node.tar.gz \
 && tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.gz \
 && node --version

# 패널 CLI 가 설치되는 ~/.local/bin 을 PATH 에 추가 (GHA step 셸에서 command -v 가 찾도록).
ENV PATH="/home/runner/.local/bin:${PATH}"

USER runner
WORKDIR /home/runner

# 4) claude-code — 공식 네이티브 설치(~/.local/bin, npm 불필요). 의장(synthesize.sh)이 `claude -p` 로 사용.
# install.sh 는 버전 없는 latest 스크립트 → SHA 핀 불가(vendor 업데이트마다 stale). latest claude 설치.
RUN curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh \
 && bash /tmp/claude-install.sh \
 && rm /tmp/claude-install.sh \
 && claude --version

# 5) Codex — Bedrock 네이티브(config.toml). 공식 standalone 설치(~/.local/bin).
# install.sh 는 버전 없는 latest 스크립트 → SHA 핀 불가(vendor 업데이트마다 stale). latest codex 설치.
RUN curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/codex-install.sh \
 && CODEX_NON_INTERACTIVE=1 sh /tmp/codex-install.sh \
 && rm /tmp/codex-install.sh \
 && codex --version

# 6) Kiro CLI — 바이너리명은 정확히 `kiro-cli`. stable/latest 채널의 ARM64 zip 을 설치(latest).
# `--v3` 는 더 좁은 모델 카탈로그로 라우팅해 gpt-5.5 를 거부했다(ADR-011) — gpt-5.6-terra(ADR-013)도
# 동일 카탈로그 제약을 받을 것으로 추정(재검증 안 함). run-panel.sh 는
# `kiro-cli chat`(v3 없이)로 호출하므로 실제 사용 플래그를 빌드에서 검증한다.
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
 # 플래그 존재만 확인하면 "빈 값 = 무툴" 시맨틱이 바뀌어도(kiro-cli 는 stable/latest 에서
 # 주간 자동 리빌드) 통과한다 — run-panel.sh 의 fail-closed 가정(15차 리뷰 M1, AWS-Demo-Platform
 # PR#63 리뷰 L3-1)이 아무 신호 없이 무력화될 수 있다. 문서화된 정확한 시맨틱 문구까지
 # 검증해 문구가 바뀌면 빌드 자체가 깨지도록 한다(fail-closed).
 && grep -F -- "trust no tools: '--trust-tools='" /tmp/kiro-chat-help \
 && rm /tmp/kiro-chat-help

# 7) Codex Bedrock 설정 baking (us-east-1, openai.gpt-5.6-sol). 러너 노드 IAM 자격증명 사용.
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
