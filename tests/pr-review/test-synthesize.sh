#!/usr/bin/env bash
# Unit tests for synthesize.sh (standalone or sourced by run-all.sh). Regression
# targets for a large chair input: stdin (not argv) delivery, total-cap trimming,
# ANSI stripping, and chair-failed.flag on primary+fallback failure — reproduces PR#195
# (chair timeout + fallback failure both silently swallowed, only a 151-byte generic
# failure was posted).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/synthesize.sh"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

setup() { # $1 = cell count (default 20), $2 = bytes per cell (default 25000), $3 = claude stub behavior
  WORK=$(mktemp -d); BIN=$(mktemp -d); DIFF=$(mktemp)
  mkdir -p "$WORK/slot"
  export PATH="$BIN:$PATH"
  echo "diff --git a/foo b/foo" > "$DIFF"
  : > "$WORK/responded.txt"
  local n="${1:-20}" size="${2:-25000}"
  local i=0
  while [ "$i" -lt "$n" ]; do
    { printf '\033[38;5;141m> \033[0mfindings\033[0m\n'; head -c "$size" /dev/zero | tr '\0' 'x'; } \
      > "$WORK/slot/model$i-L2.md"
    echo "model$i/L2" >> "$WORK/responded.txt"
    i=$((i + 1))
  done
}

# claude stub: records stdin byte count to $STDIN_SIZE_FILE, then emits a normal VERDICT.
mkclaude_ok() {
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE"
echo "Summary: ok"
echo "VERDICT: PASS"
EOF
  chmod +x "$BIN/claude"
}
mkclaude_fail() { # simulates a timeout: empty response, exit 1
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE" 2>/dev/null
echo "boom: connection refused" >&2
exit 1
EOF
  chmod +x "$BIN/claude"
}

# (a) 20 cells x 25KB: bundle goes via stdin (no argv leak), stays under
# CHAIR_PANEL_TOTAL_CAP (default 200000B).
setup 20 25000; mkclaude_ok
export STDIN_SIZE_FILE="$WORK/stdin-size.txt"
"$SCRIPT" "$DIFF" "$WORK" 1 "test pr" "$WORK/review.md" >/tmp/synth-a.log 2>&1
rc=$?
[ "$rc" -eq 0 ] && ! grep -q "Argument list too long" /tmp/synth-a.log \
  && pass "synthesize (a) completes without argv overflow" \
  || fail "synthesize (a) completes without argv overflow" "$(tail -5 /tmp/synth-a.log)"
[ -s "$WORK/stdin-size.txt" ] \
  && pass "synthesize (a) chair received input via stdin" \
  || fail "synthesize (a) chair received input via stdin" "stdin size file empty/missing"
STDIN_BYTES="$(cat "$WORK/stdin-size.txt" 2>/dev/null || echo 0)"
# raw input is 500KB (20x25000B); must be trimmed to ~200KB cap + diff
[ "$STDIN_BYTES" -gt 0 ] && [ "$STDIN_BYTES" -lt 210000 ] \
  && pass "synthesize (a) panel bundle respects total cap (~200KB)" \
  || fail "synthesize (a) panel bundle respects total cap (~200KB)" "stdin was ${STDIN_BYTES}B"
grep -q "VERDICT: PASS" "$WORK/review.md" 2>/dev/null \
  && pass "synthesize (a) valid VERDICT written" \
  || fail "synthesize (a) valid VERDICT written" "no VERDICT: PASS in review.md"

# (b) no \x1b escape sequences remain in the chair's input
if [ -s "$WORK/synth-stdin.txt" ]; then
  if grep -qP '\x1b\[' "$WORK/synth-stdin.txt" 2>/dev/null; then
    fail "synthesize (b) ANSI escapes stripped from panel bundle" "raw \\x1b[ sequence found in synth-stdin.txt"
  else
    pass "synthesize (b) ANSI escapes stripped from panel bundle"
  fi
else
  fail "synthesize (b) ANSI escapes stripped from panel bundle" "synth-stdin.txt missing"
fi

# (c) both primary+fallback fail -> chair-failed.flag set, both stderrs kept in review.md
setup 3 100; mkclaude_fail
"$SCRIPT" "$DIFF" "$WORK" 1 "test pr" "$WORK/review.md" >/tmp/synth-c.log 2>&1
[ -f "$WORK/chair-failed.flag" ] \
  && pass "synthesize (c) chair-failed.flag set when both models fail" \
  || fail "synthesize (c) chair-failed.flag set when both models fail" "flag missing"
grep -q "VERDICT: FAIL" "$WORK/review.md" 2>/dev/null \
  && pass "synthesize (c) fail-closed VERDICT: FAIL on chair failure" \
  || fail "synthesize (c) fail-closed VERDICT: FAIL on chair failure" "no VERDICT: FAIL"
grep -q "connection refused" "$WORK/review.md" 2>/dev/null \
  && pass "synthesize (c) primary stderr excerpt recorded in review body" \
  || fail "synthesize (c) primary stderr excerpt recorded in review body" "stderr excerpt not found"
[ -s "$WORK/chair-primary.err" ] && [ -s "$WORK/chair-fallback.err" ] \
  && pass "synthesize (c) primary/fallback stderr kept separate" \
  || fail "synthesize (c) primary/fallback stderr kept separate" "one of the two err files missing/empty"

unset STDIN_SIZE_FILE

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-synthesize" || exit 1
fi
