#!/usr/bin/env bash
# Unit tests for synthesize.sh. Supports both harness (sourced by run-all.sh) and
# standalone. Regression targets when the chair's input grows large: (a) it doesn't leak
# via argv (stdin path), (b) the combined total doesn't exceed the cap, (c) ANSI escapes
# get stripped, (d) if both primary+fallback fail, chair-failed.flag still records the
# cause distinctly — reproduces AWS-Demo-Platform PR#195 (even with 16 cells responding
# normally and a normal diff, the chair hit a 600s timeout, the fallback also failed in
# just 46s, the stderr behind it was never recorded anywhere, and only a 151-byte
# "review generation failed" was posted).
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

# claude stub: prints the stdin byte count to stderr (for verification), returns a
# normal VERDICT on stdout. No matter how much (or how large) is passed via argv, this
# stub itself never hits the MAX_ARG_STRLEN a real claude invocation would (bash function
# call limits are far larger), so instead it records the stdin size to a file to verify.
mkclaude_ok() {
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE"
echo "Summary: ok"
echo "VERDICT: PASS"
EOF
  chmod +x "$BIN/claude"
}
mkclaude_fail() { # simulates a timeout — always an empty response, exit 1
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE" 2>/dev/null
echo "boom: connection refused" >&2
exit 1
EOF
  chmod +x "$BIN/claude"
}

# (a) 20 cells x 25KB (with ANSI) — checks that the combined bundle doesn't leak via
# argv, is delivered to the chair via stdin, and doesn't exceed the total cap
# (CHAIR_PANEL_TOTAL_CAP, default 200000B).
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
# 20 cells at 25000B each raw (=500KB), but it must be trimmed down to at most the total
# cap (200000B) plus a few bytes of diff.
[ "$STDIN_BYTES" -gt 0 ] && [ "$STDIN_BYTES" -lt 210000 ] \
  && pass "synthesize (a) panel bundle respects total cap (~200KB)" \
  || fail "synthesize (a) panel bundle respects total cap (~200KB)" "stdin was ${STDIN_BYTES}B"
grep -q "VERDICT: PASS" "$WORK/review.md" 2>/dev/null \
  && pass "synthesize (a) valid VERDICT written" \
  || fail "synthesize (a) valid VERDICT written" "no VERDICT: PASS in review.md"

# (b) ANSI strip — checks that no escape sequences (\x1b) remain in the chair's input.
if [ -s "$WORK/synth-stdin.txt" ]; then
  if grep -qP '\x1b\[' "$WORK/synth-stdin.txt" 2>/dev/null; then
    fail "synthesize (b) ANSI escapes stripped from panel bundle" "raw \\x1b[ sequence found in synth-stdin.txt"
  else
    pass "synthesize (b) ANSI escapes stripped from panel bundle"
  fi
else
  fail "synthesize (b) ANSI escapes stripped from panel bundle" "synth-stdin.txt missing"
fi

# (c) both primary+fallback fail (simulating timeout/connection error) -> chair-failed.flag
# distinguishes the cause, and both stderrs must be left in the review.md body (so the
# cause can be diagnosed after the fact).
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
