# actions-runner-claude + PR-review 패널 CLI (codex / kiro-cli / agy).
# 베이스: 현행 published 이미지(claude-code, gh, aws, git 포함; Ubuntu 24.04 ARM64).
# NOTE(검증됨): 베이스에는 npm 이 없고, 세 CLI 모두 공식 설치 스크립트가 ~/.local/bin 에
#   바이너리를 떨군다. 그 경로는 비로그인 셸 PATH 에 없으므로 ENV PATH 로 노출한다.
FROM 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com/actions-runner-claude:latest

# 패널 CLI 가 설치되는 ~/.local/bin 을 PATH 에 추가 (GHA step 셸에서 command -v 가 찾도록).
ENV PATH="/home/runner/.local/bin:${PATH}"

USER runner

# Codex — Bedrock 네이티브(config.toml). 공식 standalone 설치.
RUN curl -fsSL https://chatgpt.com/codex/install.sh | sh \
    && codex --version

# Kiro CLI — 바이너리명은 정확히 `kiro-cli`. 공식 설치 (KIRO_API_KEY 로 인증).
RUN curl -fsSL https://cli.kiro.dev/install | bash \
    && kiro-cli --version

# Antigravity (agy) — free-tier(rate-limited) best-effort. ANTIGRAVITY_API_KEY 로 인증.
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash \
    && agy --version

# Codex Bedrock 설정 baking (us-east-2, openai.gpt-5.5). 러너 노드 IAM 자격증명 사용.
COPY --chown=runner:runner config.toml /home/runner/.codex/config.toml
