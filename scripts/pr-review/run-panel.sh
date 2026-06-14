#!/usr/bin/env bash
# 패널 병렬 fan-out. 인자: <diff> <prompt> <workdir>
# no-hang: 비대화형 플래그 + timeout + stdin 격리(diff 파이프).
set -uo pipefail
DIFF="$1"; PROMPT_FILE="$2"; WORK="$3"
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK"
SLOT="$WORK/slot"; RESP="$WORK/responded.txt"; : > "$RESP"
T="${PANEL_TIMEOUT:-300}"
PROMPT="$(cat "$PROMPT_FILE")"
KIRO_MODELS=("opus" "kimi-k2.5" "glm-5")   # Phase 0 (kiro-cli --list-models) 결과로 확정

# Codex (Bedrock, config.toml). stdin=diff, 비대화형 exec.
if command -v codex >/dev/null 2>&1; then
  ( cat "$DIFF" | timeout "$T" codex exec -s read-only "$PROMPT" > "$SLOT/codex.md" 2>"$SLOT/codex.err" || true ) &
else echo "[skip] codex (binary absent)" >&2; : > "$SLOT/codex.md"; fi

# Kiro x3
for m in "${KIRO_MODELS[@]}"; do
  tag="kiro-${m%%-*}"  # opus->kiro-opus, kimi-k2.5->kiro-kimi, glm-5->kiro-glm
  if command -v kiro-cli >/dev/null 2>&1; then
    ( cat "$DIFF" | timeout "$T" kiro-cli chat "$PROMPT" --model "$m" \
        --no-interactive --trust-tools=read,grep --wrap never \
        > "$SLOT/$tag.md" 2>"$SLOT/$tag.err" </dev/null || true ) &
  else echo "[skip] $tag (binary absent)" >&2; : > "$SLOT/$tag.md"; fi
done
wait

# 결과 집계
record_result "$SLOT/codex.md"     "codex"     "$RESP"
record_result "$SLOT/kiro-opus.md" "kiro-opus" "$RESP"
record_result "$SLOT/kiro-kimi.md" "kiro-kimi" "$RESP"
record_result "$SLOT/kiro-glm.md"  "kiro-glm"  "$RESP"
echo "Panel responded: $(tr '\n' ' ' < "$RESP")"
