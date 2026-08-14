#!/usr/bin/env bash
# Unit tests for aggregate.sh. Supports both harness (sourced by run-all.sh) and
# standalone. Verifies the aggregation/coverage-floor judging (responded.txt,
# degraded-models.txt, degraded-lenses.txt, coverage-severe.flag) that moved out of
# run-panel.sh with ADR-015 (per-model parallel job split) — the chair job merges the 4
# panel artifacts into $WORK/slot and then calls this script. Purely file-based, so no
# LLM/CLI mocking is needed.
# Roster (lib.sh): codex, kiro-fable (claude-fable-5), kiro-sol (gpt-5.6-sol), claude-self.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/aggregate.sh"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

setup() { # $1 = space-separated list of lens tags (default "L2 L3")
  WORK=$(mktemp -d); LENSES=$(mktemp -d)
  mkdir -p "$WORK/slot"
  for l in ${1:-L2 L3}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}
fill() { # $1 model_tag $2 lens $3 content (empty file if omitted)
  local f="$WORK/slot/$1-$2.md"
  if [ -n "${3:-}" ]; then echo "$3" > "$f"; else : > "$f"; fi
}

# (a) all 4 models x 2 lenses respond — no degradation, no severe, responded=8
setup "L2 L3"
for m in codex kiro-fable kiro-sol claude-self; do
  for l in L2 L3; do fill "$m" "$l" "finding"; done
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
[ "$(wc -l < "$WORK/responded.txt" 2>/dev/null || echo 0)" = 8 ] \
  && pass "aggregate (a) responded=8 (4 models x 2 lenses)" || fail "aggregate (a) responded=8 (4 models x 2 lenses)" "responded != 8"
{ [ -f "$WORK/degraded-models.txt" ] && [ ! -s "$WORK/degraded-models.txt" ]; } \
  && pass "aggregate (a) no degraded models" || fail "aggregate (a) no degraded models" "degraded-models.txt non-empty"
[ ! -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (a) no coverage-severe" || fail "aggregate (a) no coverage-severe" "flag unexpectedly set"

# (b) only kiro-sol is wiped out entirely (simulating a panel job pod death: that model's
# files simply don't exist) — the other 3 models still cross-verify each lens -> warn-only, not promoted to severe
setup "L2 L3"
for m in codex kiro-fable claude-self; do
  for l in L2 L3; do fill "$m" "$l" "finding"; done
done
# kiro-sol-*.md files don't exist at all (the artifact itself never got uploaded) — not even empty files are left
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "kiro-sol" "$WORK/degraded-models.txt" 2>/dev/null \
  && pass "aggregate (b) kiro-sol flagged degraded (missing artifact = missing model)" \
  || fail "aggregate (b) kiro-sol flagged degraded (missing artifact = missing model)" "not in degraded-models.txt"
[ ! -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (b) not severe (3/4 vendors still respond)" || fail "aggregate (b) not severe (3/4 vendors still respond)" "flag unexpectedly set"

# (c) 3 models missing (only 1 model survives) — promoted to severe
setup "L2"
fill codex L2 "finding"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (c) coverage-severe forced (only 1/4 vendor alive)" \
  || fail "aggregate (c) coverage-severe forced (only 1/4 vendor alive)" "flag not set"

# (d) one entire lens gets no response (other lenses are normal) — passes the per-model floor but the lens floor immediately goes severe
setup "L2 L3"
for m in codex kiro-fable kiro-sol claude-self; do
  fill "$m" "L2" "finding"
  fill "$m" "L3" ""   # L3 gets an empty response from every model
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "L3" "$WORK/degraded-lenses.txt" 2>/dev/null \
  && pass "aggregate (d) L3 flagged as fully-degraded lens" || fail "aggregate (d) L3 flagged as fully-degraded lens" "not in degraded-lenses.txt"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (d) lens collapse forces coverage-severe immediately" \
  || fail "aggregate (d) lens collapse forces coverage-severe immediately" "flag not set despite empty lens"

# (e) a tag outside the roster — guards against matrix.model/lib.sh drift, fails
# immediately instead of silently passing. Empty cells are checked too (regardless of
# file size) — a drifted tag must be caught even if it always produces an empty response.
setup "L2"
fill codex L2 "finding"
fill "totally-unknown-model" L2 ""
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "aggregate (e) unknown model tag in slot fails loudly (even if empty)" \
  || fail "aggregate (e) unknown model tag in slot fails loudly (even if empty)" "exited 0 with unknown tag present"

# (f) fails immediately if lenses_dir is empty
setup "L2"; rm -f "$LENSES"/*.txt
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "aggregate (f) empty lenses_dir fails loudly" || fail "aggregate (f) empty lenses_dir fails loudly" "exited 0 with no lens files"

# (g) $WORK/slot itself doesn't exist (simulating panel job total failure +
# download-artifact having nothing to match) — this must not hard-fail; it should be
# treated as "all models unresponsive" and still reach coverage-severe.flag (PR#88 review
# MAJOR: previously this exited 1 here, leaving no severe flag/comment/gate reason at all).
setup "L2"; rm -rf "$WORK/slot"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && pass "aggregate (g) missing slot dir does not hard-fail" \
  || fail "aggregate (g) missing slot dir does not hard-fail" "exited $rc"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (g) missing slot dir -> coverage-severe (all models degraded)" \
  || fail "aggregate (g) missing slot dir -> coverage-severe (all models degraded)" "flag not set"

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-aggregate" || exit 1
fi
