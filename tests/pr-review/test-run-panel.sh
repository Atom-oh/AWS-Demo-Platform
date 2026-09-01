#!/usr/bin/env bash
# Unit tests for run-panel.sh (PATH-mocked CLIs; standalone or sourced by run-all.sh).
# Per-model job (ADR-015): 4th arg <model_tag> runs one model's full lens set only;
# responded.txt/degraded-*/coverage-severe now live in aggregate.sh (test-aggregate.sh).
# Roster (lib.sh): codex, kiro-fable (claude-fable-5), kiro-sol (gpt-5.6-sol), claude-self.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/run-panel.sh"
ORIGINAL_PATH="$PATH"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

cleanup() {
  PATH="$ORIGINAL_PATH"
  export PATH
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  [ -n "${BIN:-}" ] && rm -rf "$BIN"
  [ -n "${LENSES:-}" ] && rm -rf "$LENSES"
  WORK=""; BIN=""; LENSES=""
}

mkfake() { # $1 binname, $2 exitcode, $3 marker
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
if [ "$2" -eq 0 ]; then echo "$3"; cat; else exit $2; fi
EOF
  chmod +x "$BIN/$1"
}

setup() { # $1 = space-separated list of lens tags (default L2)
  cleanup
  WORK=$(mktemp -d); BIN=$(mktemp -d); LENSES=$(mktemp -d)
  PATH="$BIN:$ORIGINAL_PATH"
  export PATH
  echo "diff --git a b" > "$WORK/diff.txt"
  for l in ${1:-L2}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}

# (a) codex tag fills only codex's cells; other models' slots untouched
setup "L2 L3"; mkfake codex 0 "codex-finding"; mkfake kiro-cli 0 "kiro-finding"; mkfake claude 0 "claude-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
allok=1; diffok=1
for f in codex-L2 codex-L3; do
  [ -s "$WORK/slot/$f.md" ] || allok=0
  grep -q "diff --git" "$WORK/slot/$f.md" 2>/dev/null || diffok=0
done
[ "$allok" = 1 ] && pass "run-panel (a) codex tag: both lens cells filled" || fail "run-panel (a) codex tag: both lens cells filled" "a slot is empty"
[ "$diffok" = 1 ] && pass "run-panel (a) diff reached every cell (stdin)" || fail "run-panel (a) diff reached every cell (stdin)" "a cell got empty stdin"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] && [ ! -e "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (a) codex call does not touch other models' slots" \
  || fail "run-panel (a) codex call does not touch other models' slots" "unexpected slot file present"
[ ! -f "$WORK/responded.txt" ] \
  && pass "run-panel (a) no responded.txt written (aggregate.sh's job now)" \
  || fail "run-panel (a) no responded.txt written (aggregate.sh's job now)" "responded.txt unexpectedly created"

# (b) kiro-sol calls kiro-cli with gpt-5.6-sol; sibling kiro-fable slot untouched
setup; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-sol >/dev/null 2>&1
[ -s "$WORK/slot/kiro-sol-L2.md" ] \
  && pass "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" || fail "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" "slot missing/empty"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] \
  && pass "run-panel (b) sibling kiro tag untouched" || fail "run-panel (b) sibling kiro tag untouched" "kiro-fable slot appeared"

# (c) claude-self: CLI always exits 1 -> empty slot after retries exhaust, non-blocking.
# (Exit-1 stands in for "not installed" since the real `claude` binary is already on PATH here.)
setup; mkfake claude 1 ""
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && [ -f "$WORK/slot/claude-self-L2.md" ] && [ ! -s "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" \
  || fail "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" "rc=$rc"

# (d) unknown model_tag fails loudly (catches matrix.model drift)
setup
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" not-a-real-model >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (d) unknown model_tag fails loudly" || fail "run-panel (d) unknown model_tag fails loudly" "exited 0 with unknown tag"

# (e) empty lenses_dir fails immediately (not silently 0 cells)
setup; rm -f "$LENSES"/*.txt; mkfake codex 0 "codex-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (e) empty lenses_dir fails loudly" || fail "run-panel (e) empty lenses_dir fails loudly" "exited 0 with no lens files"

# (f) Claude self-review keeps bounded local/gh read tools but excludes GitHub MCP tools.
setup
export CLAUDE_ARGV_FILE="$WORK/claude-argv.txt"
cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CLAUDE_ARGV_FILE"
echo "claude-finding"
cat
EOF
chmod +x "$BIN/claude"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
if grep -Fq 'mcp__github__' "$CLAUDE_ARGV_FILE"; then
  fail "run-panel (f) Claude self-review argv excludes GitHub MCP tools" "GitHub MCP tool present"
elif grep -Fq 'Read Grep Glob' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh pr diff:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh pr view:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh search:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh issue view:*)' "$CLAUDE_ARGV_FILE"; then
  pass "run-panel (f) Claude self-review argv uses bounded read-only tools"
else
  fail "run-panel (f) Claude self-review argv uses bounded read-only tools" "expected allowedTools missing"
fi

cleanup
unset CLAUDE_ARGV_FILE

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-run-panel" || exit 1
fi
