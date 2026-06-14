#!/usr/bin/env bash
# 패널 병렬 fan-out. 인자: <diff> <prompt> <workdir>
# diff 는 각 CLI 의 stdin 으로 `< "$DIFF"` 직접 리다이렉트(파일이라 TTY 아님 → no-hang),
# timeout 백스톱 + 비대화형 플래그로 멈춤 방지.
# 주의: `cat "$DIFF" | ... </dev/null` 금지 — `</dev/null` 가 파이프 stdin 을 덮어써
# diff 가 버려진다(좌→우 리다이렉션). 반드시 `< "$DIFF"` 단일 리다이렉트.
set -uo pipefail
DIFF="$1"; PROMPT_FILE="$2"; WORK="$3"
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK"
SLOT="$WORK/slot"; RESP="$WORK/responded.txt"; : > "$RESP"
T="${PANEL_TIMEOUT:-300}"
PROMPT="$(cat "$PROMPT_FILE")"
KIRO_MODELS=("opus" "kimi-k2.5" "glm-5")   # Phase 0 (kiro-cli --list-models) 결과로 확정

# Codex (Bedrock, config.toml). stdin=diff(파일), 비대화형 exec.
if command -v codex >/dev/null 2>&1; then
  ( timeout "$T" codex exec -s read-only "$PROMPT" > "$SLOT/codex.md" 2>"$SLOT/codex.err" < "$DIFF" || true ) &
else echo "[skip] codex (binary absent)" >&2; : > "$SLOT/codex.md"; fi

# Kiro x3
for m in "${KIRO_MODELS[@]}"; do
  tag="kiro-${m%%-*}"  # opus->kiro-opus, kimi-k2.5->kiro-kimi, glm-5->kiro-glm
  if command -v kiro-cli >/dev/null 2>&1; then
    ( timeout "$T" kiro-cli chat "$PROMPT" --model "$m" \
        --no-interactive --trust-tools=read,grep --wrap never \
        > "$SLOT/$tag.md" 2>"$SLOT/$tag.err" < "$DIFF" || true ) &
  else echo "[skip] $tag (binary absent)" >&2; : > "$SLOT/$tag.md"; fi
done

# Antigravity (agy). best-effort: ANTIGRAVITY_API_KEY 는 free tier(rate-limited) 라
# 429/쿼터 초과 시 graceful skip. (agy 플래그는 Phase 0 에서 확정)
if command -v agy >/dev/null 2>&1; then
  ( timeout "$T" agy -p "$PROMPT" > "$SLOT/antigravity.md" 2>"$SLOT/antigravity.err" < "$DIFF" || true ) &
else echo "[skip] antigravity (binary absent)" >&2; : > "$SLOT/antigravity.md"; fi
wait

# 결과 집계
record_result "$SLOT/codex.md"       "codex"       "$RESP"
record_result "$SLOT/kiro-opus.md"   "kiro-opus"   "$RESP"
record_result "$SLOT/kiro-kimi.md"   "kiro-kimi"   "$RESP"
record_result "$SLOT/kiro-glm.md"    "kiro-glm"    "$RESP"
record_result "$SLOT/antigravity.md" "antigravity" "$RESP"
echo "Panel responded: $(tr '\n' ' ' < "$RESP")"
