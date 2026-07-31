#!/usr/bin/env bash
# synthesize.sh 단위 테스트. harness(run-all.sh 가 source) + standalone 모두 지원.
# 회귀 대상: chair 입력이 커질 때 (a) argv 로 새지 않는지(stdin 경로), (b) 합본 총량이
# 캡을 넘지 않는지, (c) ANSI 이스케이프가 제거되는지, (d) primary+fallback 모두 실패해도
# chair-failed.flag 로 원인을 구분해 남기는지 — AWS-Demo-Platform PR#195 재현
# (16셀 정상 응답 + 정상 diff 인데도 chair 가 600s timeout, fallback 도 46s 만에 실패,
# 원인 stderr 는 어디에도 안 남고 151바이트 "리뷰 생성 실패"만 게시됨).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/synthesize.sh"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

setup() { # $1 = 셀 개수(기본 20), $2 = 셀당 바이트(기본 25000), $3 = claude 스텁 동작
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

# claude 스텁: stdin 바이트 수를 stderr 로 찍고(검증용), 정상 VERDICT 를 stdout 에 반환.
# argv 에 뭐가 얼마나 크게 실려도 실제 claude 라면 겪을 MAX_ARG_STRLEN 은 이 스텁 자체는
# 겪지 않으므로(bash 함수 호출 한도가 훨씬 큼), 대신 stdin 크기를 파일로 남겨 검증한다.
mkclaude_ok() {
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE"
echo "Summary: ok"
echo "VERDICT: PASS"
EOF
  chmod +x "$BIN/claude"
}
mkclaude_fail() { # timeout 을 흉내 — 항상 빈 응답, exit 1
  cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
wc -c < /dev/stdin > "$STDIN_SIZE_FILE" 2>/dev/null
echo "boom: connection refused" >&2
exit 1
EOF
  chmod +x "$BIN/claude"
}

# (a) 20셀×25KB(ANSI 포함) — 합본이 argv 로 새지 않고, stdin 경유로 chair 에 전달되는지,
# 그리고 총량 캡(CHAIR_PANEL_TOTAL_CAP 기본 200000B) 을 넘지 않는지.
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
# 20셀 원본 25000B(=500KB) 인데 총량 캡(200000B)+diff 몇 바이트 이하로 줄어야 함.
[ "$STDIN_BYTES" -gt 0 ] && [ "$STDIN_BYTES" -lt 210000 ] \
  && pass "synthesize (a) panel bundle respects total cap (~200KB)" \
  || fail "synthesize (a) panel bundle respects total cap (~200KB)" "stdin was ${STDIN_BYTES}B"
grep -q "VERDICT: PASS" "$WORK/review.md" 2>/dev/null \
  && pass "synthesize (a) valid VERDICT written" \
  || fail "synthesize (a) valid VERDICT written" "no VERDICT: PASS in review.md"

# (b) ANSI 스트립 — chair 입력에 이스케이프 시퀀스(\x1b)가 남지 않는지.
if [ -s "$WORK/synth-stdin.txt" ]; then
  if grep -qP '\x1b\[' "$WORK/synth-stdin.txt" 2>/dev/null; then
    fail "synthesize (b) ANSI escapes stripped from panel bundle" "raw \\x1b[ sequence found in synth-stdin.txt"
  else
    pass "synthesize (b) ANSI escapes stripped from panel bundle"
  fi
else
  fail "synthesize (b) ANSI escapes stripped from panel bundle" "synth-stdin.txt missing"
fi

# (c) primary+fallback 모두 실패(timeout/연결오류 흉내) → chair-failed.flag 로 원인 구분,
# 두 stderr 모두 review.md 본문에 남아야(사후 규명 가능).
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
