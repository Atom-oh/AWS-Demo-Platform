# 현행 actions-runner-claude 와 패리티 유지(claude-code, gh, aws, node, git 포함).
# 기존 published 이미지를 베이스로 codex/kiro-cli/agy 만 얹어 회귀 위험 최소화.
# (Phase 0.1 에서 베이스 도구 버전 패리티 확인, Phase 0.2/0.3 에서 아래 설치 명령 확정.)
FROM 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com/actions-runner-claude:latest

USER root

# Codex CLI (Phase 0.2 결과: npm 경로. 바이너리 릴리스면 이 RUN 을 교체)
RUN npm install -g @openai/codex \
    && codex --version

# Kiro CLI — 바이너리명은 정확히 `kiro-cli` (NOT `kiro`).
# Phase 0.3 에서 확정된 ARM64 설치 명령으로 교체. 아래는 스크립트 설치 기본형.
RUN curl -fsSL https://kiro.dev/install.sh | sh \
    && kiro-cli --version

# Antigravity CLI (agy). free tier(rate-limited) best-effort 패널. ANTIGRAVITY_API_KEY 로 인증.
# Phase 0 에서 ARM64 설치 명령 + `agy -p` 플래그 확정.
RUN curl -fsSL https://antigravity.google/install.sh | sh \
    && agy --version

# Codex Bedrock 설정 baking (us-east-2, openai.gpt-5.5). 러너 노드 IAM 자격증명 사용.
COPY config.toml /home/runner/.codex/config.toml
RUN chown -R runner:runner /home/runner/.codex

USER runner
