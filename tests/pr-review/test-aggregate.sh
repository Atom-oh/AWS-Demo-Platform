#!/usr/bin/env bash
# Unit tests for aggregate.sh (standalone or sourced by run-all.sh). File-based only —
# no CLI mocking needed. Covers the coverage-floor judging (responded.txt,
# degraded-models.txt, degraded-lenses.txt, coverage-severe.flag) moved here from
# run-panel.sh under ADR-015.
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

# (a) all 4 models x 2 lenses respond -> no degradation, no severe
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

# (b) kiro-sol's files don't exist at all (panel job pod death) — 3/4 models still
# cover each lens -> warn-only, not promoted to severe
setup "L2 L3"
for m in codex kiro-fable claude-self; do
  for l in L2 L3; do fill "$m" "$l" "finding"; done
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "kiro-sol" "$WORK/degraded-models.txt" 2>/dev/null \
  && pass "aggregate (b) kiro-sol flagged degraded (missing artifact = missing model)" \
  || fail "aggregate (b) kiro-sol flagged degraded (missing artifact = missing model)" "not in degraded-models.txt"
[ ! -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (b) not severe (3/4 vendors still respond)" || fail "aggregate (b) not severe (3/4 vendors still respond)" "flag unexpectedly set"

# (c) only 1/4 models survives -> promoted to severe
setup "L2"
fill codex L2 "finding"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (c) coverage-severe forced (only 1/4 vendor alive)" \
  || fail "aggregate (c) coverage-severe forced (only 1/4 vendor alive)" "flag not set"

# (d) one lens gets no response from any model -> lens floor goes severe immediately
setup "L2 L3"
for m in codex kiro-fable kiro-sol claude-self; do
  fill "$m" "L2" "finding"
  fill "$m" "L3" ""
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "L3" "$WORK/degraded-lenses.txt" 2>/dev/null \
  && pass "aggregate (d) L3 flagged as fully-degraded lens" || fail "aggregate (d) L3 flagged as fully-degraded lens" "not in degraded-lenses.txt"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (d) lens collapse forces coverage-severe immediately" \
  || fail "aggregate (d) lens collapse forces coverage-severe immediately" "flag not set despite empty lens"

# (e) unknown model tag in slot fails loudly (even if empty), guards matrix.model drift
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

# (g) $WORK/slot missing entirely (panel job total failure) -> must not hard-fail;
# treat as all-models-unresponsive and still set coverage-severe.flag (regression: PR#88 exited 1 here)
setup "L2"; rm -rf "$WORK/slot"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && pass "aggregate (g) missing slot dir does not hard-fail" \
  || fail "aggregate (g) missing slot dir does not hard-fail" "exited $rc"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (g) missing slot dir -> coverage-severe (all models degraded)" \
  || fail "aggregate (g) missing slot dir -> coverage-severe (all models degraded)" "flag not set"

# (h) Per-model Kiro flags written by run-panel.sh into the uploaded slot are merged into
# one WORK-level flag each. Preflight failure and agent fallback force coverage-severe even
# though 3/4 models still responded; quota alone does not (coverage floors decide).
for kflag in preflight agent-fallback quota; do
  setup "L2"
  for m in codex kiro-fable claude-self; do fill "$m" L2 "finding"; done
  fill kiro-sol L2 ""
  printf 'kiro-sol detail one\n' > "$WORK/slot/kiro-$kflag-kiro-sol.flag"
  "$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>"$WORK/agg.err"
  rc=$?
  merged="$WORK/kiro-$kflag.flag"
  if [ "$kflag" = quota ]; then want_severe=0; else want_severe=1; fi
  have_severe=0; [ -f "$WORK/coverage-severe.flag" ] && have_severe=1
  if [ "$rc" -eq 0 ] && [ -s "$merged" ] && grep -q 'kiro-sol detail one' "$merged" \
    && [ "$have_severe" = "$want_severe" ] && grep -q "^::error::" "$WORK/agg.err"; then
    pass "aggregate (h) kiro-$kflag-<tag>.flag merged into kiro-$kflag.flag (severe=$want_severe)"
  else
    fail "aggregate (h) kiro-$kflag-<tag>.flag merged into kiro-$kflag.flag (severe=$want_severe)" \
      "rc=$rc merged=$([ -s "$merged" ] && echo yes || echo no) severe=$have_severe"
  fi
done

# (i) Two Kiro jobs both flag quota: both details end up in the merged flag; stale merged
# flags from a previous chair run on a reused $WORK are reset when no slot flag exists.
setup "L2"
for m in codex claude-self; do fill "$m" L2 "finding"; done
fill kiro-fable L2 ""; fill kiro-sol L2 ""
echo "fable reset on 10/01" > "$WORK/slot/kiro-quota-kiro-fable.flag"
echo "sol reset on 10/01" > "$WORK/slot/kiro-quota-kiro-sol.flag"
echo "stale" > "$WORK/kiro-agent-fallback.flag"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
if grep -q 'fable reset' "$WORK/kiro-quota.flag" && grep -q 'sol reset' "$WORK/kiro-quota.flag" \
  && [ ! -f "$WORK/kiro-agent-fallback.flag" ] && [ ! -f "$WORK/coverage-severe.flag" ]; then
  pass "aggregate (i) quota flags from both Kiro jobs merge; stale merged flags are reset; 2/4 dead stays warn-only"
else
  fail "aggregate (i) quota flags from both Kiro jobs merge; stale merged flags are reset; 2/4 dead stays warn-only" \
    "quota=$(cat "$WORK/kiro-quota.flag" 2>/dev/null | tr '\n' '|') stale=$([ -f "$WORK/kiro-agent-fallback.flag" ] && echo present) severe=$([ -f "$WORK/coverage-severe.flag" ] && echo yes)"
fi

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-aggregate" || exit 1
fi
