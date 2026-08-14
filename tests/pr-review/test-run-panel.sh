#!/usr/bin/env bash
# Unit tests for run-panel.sh. Supports both harness (sourced by run-all.sh) and
# standalone. Uses PATH mocking instead of real CLIs to verify (a) codex tag response
# (b) kiro-sol tag response, with no interference from the sibling kiro tag (c) empty
# slot after claude-self exhausts its retries (non-blocking) (d) rejection of an unknown
# model tag (e) rejection of an empty lenses_dir — "total failure" verification is now
# out of scope for a single model's call (that's aggregate.sh's coverage-floor
# responsibility, see test-aggregate.sh).
#
# Splitting into per-model parallel jobs (ADR-015) changed the arguments/responsibilities:
# the 4th argument <model_tag> now runs only one model's full lens set (4 cells), and
# responded.txt/degraded-*/coverage-severe aggregation no longer happens here (it's the
# chair job's aggregate.sh, after all 4 parallel jobs finish — see test-aggregate.sh).
# This file only checks that "one model's call correctly produces just its own lens
# cells." Roster (lib.sh): codex, kiro-fable (claude-fable-5), kiro-sol (gpt-5.6-sol),
# claude-self.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/run-panel.sh"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

mkfake() { # $1 binname, $2 exitcode, $3 marker. On success, echo marker + stdin (diff)
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
if [ "$2" -eq 0 ]; then echo "$3"; cat; else exit $2; fi
EOF
  chmod +x "$BIN/$1"
}
setup() { # $1 = space-separated list of lens tags (default L2)
  WORK=$(mktemp -d); BIN=$(mktemp -d); LENSES=$(mktemp -d)
  export PATH="$BIN:$PATH"
  echo "diff --git a b" > "$WORK/diff.txt"
  for l in ${1:-L2}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}

# (a) codex tag — 2 lenses (L2,L3), only codex produces cells; kiro/claude-self slots untouched
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

# (b) kiro-sol tag — checks the model itself calls kiro-cli with gpt-5.6-sol (no mix-up with kiro-fable)
setup; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-sol >/dev/null 2>&1
[ -s "$WORK/slot/kiro-sol-L2.md" ] \
  && pass "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" || fail "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" "slot missing/empty"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] \
  && pass "run-panel (b) sibling kiro tag untouched" || fail "run-panel (b) sibling kiro tag untouched" "kiro-fable slot appeared"

# (c) claude-self tag, CLI fails every time (exit 1) — empty slot after PANEL_RETRIES
# exhausts, non-blocking. (The actual not-installed-binary case can't be reproduced by
# just prepending $BIN, since this runner environment already has the system `claude`
# CLI on PATH — a failing exit code verifies the same "no response" path instead.)
setup; mkfake claude 1 ""
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && [ -f "$WORK/slot/claude-self-L2.md" ] && [ ! -s "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" \
  || fail "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" "rc=$rc"

# (d) a model_tag outside the roster fails immediately — matrix.model typos/drift are not silently let through
setup
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" not-a-real-model >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (d) unknown model_tag fails loudly" || fail "run-panel (d) unknown model_tag fails loudly" "exited 0 with unknown tag"

# (e) if lenses_dir has no *.txt files, treat it as a misconfigured argument and fail immediately (don't silently produce 0 cells)
setup; rm -f "$LENSES"/*.txt; mkfake codex 0 "codex-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (e) empty lenses_dir fails loudly" || fail "run-panel (e) empty lenses_dir fails loudly" "exited 0 with no lens files"

# standalone exit code (skipped under harness, where _t_fail is undefined)
if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-run-panel" || exit 1
fi
