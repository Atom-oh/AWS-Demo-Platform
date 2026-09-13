#!/usr/bin/env bash
# Exercise trusted context delivery through preparation and the isolated Kiro call.
(
set -uo pipefail
PREP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREP_TMP="$(mktemp -d)"
trap 'rm -rf "$PREP_TMP"' EXIT
mkdir -p "$PREP_TMP/bin"
export PREP_TMP GH_REPO=example/platform PANEL_RETRIES=1 PANEL_TIMEOUT=5
export PATH="$PREP_TMP/bin:$PATH"
cat > "$PREP_TMP/context" <<'EOF'
# Trusted base context
Documentation is English; product UI copy may be Korean.
EOF
cat > "$PREP_TMP/diff" <<'EOF'
diff --git a/AGENTS.md b/AGENTS.md
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -1 +1 @@
-base rules
+UNTRUSTED_HEAD_INSTRUCTION
EOF
cat > "$PREP_TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PREP_TMP/requests"
case "$2" in
  repos/example/platform/compare/BASE...HEAD) cat "$PREP_TMP/diff" ;;
  'repos/example/platform/contents/AGENTS.md?ref=BASE')
    [ ! -f "$PREP_TMP/fail-context" ] || exit 1
    base64 < "$PREP_TMP/context"
    ;;
  *) exit 2 ;;
esac
EOF
# Kiro receives a sanitized environment: record argv in its isolated working directory.
cat > "$PREP_TMP/bin/kiro-cli" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > argv.txt
printf 'reviewed\n'
EOF
chmod +x "$PREP_TMP/bin/"*
prep_fail=0
check() {
  if "$@"; then
    printf '  OK prepare-inputs: %s\n' "$*"
  else
    printf '  FAIL prepare-inputs: %s\n' "$*" >&2
    prep_fail=1
  fi
}
bash "$PREP_ROOT/scripts/pr-review/prepare-inputs.sh" HEAD BASE "$PREP_TMP/work" >/dev/null
for lens in L2 L3 L4 L5; do
  check grep -Fq 'Documentation is English; product UI copy may be Korean.' "$PREP_TMP/work/lenses/$lens.txt"
done
check cmp "$PREP_TMP/context" "$PREP_TMP/work/project-context.md"
if grep -Fq UNTRUSTED_HEAD_INSTRUCTION "$PREP_TMP/work/lenses/L2.txt"; then
  printf '  FAIL PR head content was promoted to context\n' >&2
  prep_fail=1
fi
bash "$PREP_ROOT/scripts/pr-review/run-panel.sh" "$PREP_TMP/work/pr-diff-truncated.txt" \
  "$PREP_TMP/work/lenses" "$PREP_TMP/work" kiro-fable >/dev/null
for lens in L2 L3 L4 L5; do
  argv="$PREP_TMP/work/kiro-cwd/kiro-fable-$lens/argv.txt"
  check grep -Fq 'Documentation is English; product UI copy may be Korean.' "$argv"
  check grep -Fq UNTRUSTED_HEAD_INSTRUCTION "$argv"
  check grep -Fxq -- '--trust-tools=' "$argv"
done
# The largest supported digest and normal Kiro diff cap still fit one argument.
head -c 12288 /dev/zero | tr '\0' x > "$PREP_TMP/context"
head -c 100001 /dev/zero | tr '\0' y > "$PREP_TMP/diff"
bash "$PREP_ROOT/scripts/pr-review/prepare-inputs.sh" HEAD BASE "$PREP_TMP/maximum" >/dev/null
bash "$PREP_ROOT/scripts/pr-review/run-panel.sh" "$PREP_TMP/maximum/pr-diff-truncated.txt" \
  "$PREP_TMP/maximum/lenses" "$PREP_TMP/maximum" kiro-fable >/dev/null 2>&1
check test -s "$PREP_TMP/maximum/slot/kiro-fable-L2.md"
check test -f "$PREP_TMP/maximum/slot/kiro-diff-truncated.flag"
maximum_argv="$PREP_TMP/maximum/kiro-cwd/kiro-fable-L2/argv.txt"
check test "$(wc -c < "$maximum_argv")" -lt 131072
# Custom lens/input growth must fail explicitly rather than executing an oversized argv.
head -c 131072 /dev/zero | tr '\0' z > "$PREP_TMP/maximum/lenses/L2.txt"
if bash "$PREP_ROOT/scripts/pr-review/run-panel.sh" "$PREP_TMP/maximum/pr-diff-truncated.txt" \
  "$PREP_TMP/maximum/lenses" "$PREP_TMP/maximum" kiro-fable >/dev/null 2>&1; then
  printf '  FAIL oversized Kiro argument accepted\n' >&2
  prep_fail=1
fi
# Missing or oversized context must fail rather than silently reviewing without it.
touch "$PREP_TMP/fail-context"
if bash "$PREP_ROOT/scripts/pr-review/prepare-inputs.sh" HEAD BASE "$PREP_TMP/missing" >/dev/null 2>&1; then
  printf '  FAIL missing trusted context accepted\n' >&2
  prep_fail=1
fi
rm "$PREP_TMP/fail-context"
head -c 12289 /dev/zero | tr '\0' x > "$PREP_TMP/context"
if bash "$PREP_ROOT/scripts/pr-review/prepare-inputs.sh" HEAD BASE "$PREP_TMP/oversized" >/dev/null 2>&1; then
  printf '  FAIL oversized trusted context accepted\n' >&2
  prep_fail=1
fi
exit "$prep_fail"
)
PREP_RESULT=$?
if declare -F pass >/dev/null 2>&1; then
  [ "$PREP_RESULT" -eq 0 ] && pass "prepare-inputs: trusted context reaches isolated Kiro" \
    || fail "prepare-inputs: trusted context reaches isolated Kiro" "see failed assertions"
else
  exit "$PREP_RESULT"
fi
