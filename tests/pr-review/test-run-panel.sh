#!/usr/bin/env bash
# run-panel.sh 단위 테스트. 실제 CLI 대신 PATH 모킹으로 (a)전원응답 (b)일부skip (c)전원실패 검증.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/../../scripts/pr-review" && pwd)/run-panel.sh"
fail=0
mkfake() { # $1 binname, $2 exitcode, $3 output
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
[ "$2" -eq 0 ] && echo "$3"
exit $2
EOF
  chmod +x "$BIN/$1"
}
setup() { WORK=$(mktemp -d); BIN=$(mktemp -d); export PATH="$BIN:$PATH"
  echo "diff --git a b" > "$WORK/diff.txt"; echo "review this" > "$WORK/prompt.txt"; }

# (a) 전원 응답
setup; mkfake codex 0 "codex-finding"; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
for f in codex kiro-opus kiro-kimi kiro-glm; do
  [ -s "$WORK/slot/$f.md" ] || { echo "FAIL(a): $f.md empty"; fail=1; }
done
[ "$(wc -l < "$WORK/responded.txt")" -eq 4 ] || { echo "FAIL(a): responded != 4"; fail=1; }

# (b) kiro 전체 실패(codex만 응답)
setup; mkfake codex 0 "codex-finding"; mkfake kiro-cli 1 ""
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
grep -q "codex" "$WORK/responded.txt" || { echo "FAIL(b): codex missing"; fail=1; }
grep -q "kiro" "$WORK/responded.txt" && { echo "FAIL(b): kiro should skip"; fail=1; }

# (c) 전원 실패 → responded 비어야 함 (결정론적: 모든 모킹 exit 1)
setup; mkfake codex 1 ""; mkfake kiro-cli 1 ""
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
[ -f "$WORK/responded.txt" ] && [ ! -s "$WORK/responded.txt" ] || { echo "FAIL(c): responded should be empty"; fail=1; }

[ "$fail" -eq 0 ] && echo "PASS: test-run-panel" || exit 1
