#!/usr/bin/env bash
# run-panel.sh 단위 테스트. harness(run-all.sh 가 source) + standalone 모두 지원.
# 실제 CLI 대신 PATH 모킹으로 (a)전원응답 (b)일부skip (c)전원실패 검증.
# 주의: harness 가 이 파일을 source 하므로 set -e/-u 나 exit 로 셸을 오염/중단하지 않는다.
#
# lens×model 매트릭스(#59)로 인자/슬롯 규약이 바뀜: 인자 2는 prompt 파일이 아니라
# lenses 디렉터리, 슬롯은 <model>-<lens>.md, responded 항목은 <model>/<lens>.
# 패널 = codex + kiro-opus/kiro-gpt/kiro-glm + claude-self(이 repo만의 5번째 멤버) = 5모델.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/run-panel.sh"

# standalone 실행 시 harness 의 pass/fail 가 없으므로 폴백 정의 + 종료코드 추적.
if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

mkfake() { # $1 binname, $2 exitcode, $3 marker. 성공 시 marker + stdin(diff) 를 echo
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
if [ "$2" -eq 0 ]; then echo "$3"; cat; else exit $2; fi
EOF
  chmod +x "$BIN/$1"
}
setup() { # $1 = lens 태그 목록(공백 구분, 기본 L2)
  WORK=$(mktemp -d); BIN=$(mktemp -d); LENSES=$(mktemp -d)
  export PATH="$BIN:$PATH"
  echo "diff --git a b" > "$WORK/diff.txt"
  for l in ${1:-L2}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}

# (a) 전원 응답, 단일 lens(L2) — codex + kiro x3 + claude-self = 5 셀
setup; mkfake codex 0 "codex-finding"; mkfake kiro-cli 0 "kiro-finding"; mkfake claude 0 "claude-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" >/dev/null 2>&1
allok=1; diffok=1
for f in codex-L2 kiro-opus-L2 kiro-gpt-L2 kiro-glm-L2 claude-self-L2; do
  [ -s "$WORK/slot/$f.md" ] || allok=0
  # 각 패널의 stdin 으로 diff 가 실제 전달됐는지 검증 (</dev/null 가 파이프를 덮는 회귀 방지)
  grep -q "diff --git" "$WORK/slot/$f.md" 2>/dev/null || diffok=0
done
[ "$allok" = 1 ] && pass "run-panel (a) all 5 slots filled" || fail "run-panel (a) all 5 slots filled" "a slot is empty"
[ "$diffok" = 1 ] && pass "run-panel (a) diff reached every cell (stdin)" || fail "run-panel (a) diff reached every cell (stdin)" "a cell got empty stdin"
[ "$(wc -l < "$WORK/responded.txt" 2>/dev/null || echo 0)" = 5 ] \
  && pass "run-panel (a) responded=5" || fail "run-panel (a) responded=5" "responded != 5"
grep -q "^kiro-gpt/L2$" "$WORK/responded.txt" 2>/dev/null \
  && pass "run-panel (a) kiro-gpt tag present (not kiro-kimi)" || fail "run-panel (a) kiro-gpt tag present (not kiro-kimi)" "kiro-gpt/L2 missing"

# (b) kiro 실패(codex/claude-self만 응답), 2 lens(L2,L3) — kiro 3개는 매 lens 마다 탈락하지만
# codex+claude-self 는 각 lens 를 여전히 교차확인하므로 DEGRADED_COUNT(3) < TOTAL_MODELS-1(4),
# severe 승격은 안 됨(warn-only 유지) — coverage-severe.flag 부재로 함께 검증.
setup "L2 L3"; mkfake codex 0 "codex-finding"; mkfake kiro-cli 1 ""; mkfake claude 0 "claude-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" >/dev/null 2>&1
grep -q "^codex/L2$" "$WORK/responded.txt" 2>/dev/null && grep -q "^codex/L3$" "$WORK/responded.txt" 2>/dev/null \
  && pass "run-panel (b) codex responded on every lens" || fail "run-panel (b) codex responded on every lens" "codex missing on some lens"
grep -q "^kiro-" "$WORK/responded.txt" 2>/dev/null \
  && fail "run-panel (b) kiro skipped" "a kiro-* row should be absent" || pass "run-panel (b) kiro skipped"
grep -qx "kiro-opus" "$WORK/degraded-models.txt" 2>/dev/null \
  && pass "run-panel (b) kiro-opus flagged degraded" || fail "run-panel (b) kiro-opus flagged degraded" "not in degraded-models.txt"
[ -f "$WORK/coverage-severe.flag" ] \
  && fail "run-panel (b) not coverage-severe" "flag set when 2/5 vendors still respond" || pass "run-panel (b) not coverage-severe"

# (c) 전원 실패 → responded 비어야 하고, 전 모델 탈락이라 coverage-severe.flag 가 서야 함
setup; mkfake codex 1 ""; mkfake kiro-cli 1 ""; mkfake claude 1 ""
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" >/dev/null 2>&1
{ [ -f "$WORK/responded.txt" ] && [ ! -s "$WORK/responded.txt" ]; } \
  && pass "run-panel (c) responded empty" || fail "run-panel (c) responded empty" "responded not empty"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "run-panel (c) coverage-severe forced (all vendors down)" || fail "run-panel (c) coverage-severe forced (all vendors down)" "flag not set"

# (d) lenses_dir 에 *.txt 가 없으면 인자 오설정으로 간주하고 즉시 실패(0셀로 조용히 넘어가지 않음)
setup; rm -f "$LENSES"/*.txt; mkfake codex 0 "codex-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (d) empty lenses_dir fails loudly" || fail "run-panel (d) empty lenses_dir fails loudly" "exited 0 with no lens files"

# standalone 종료코드 (harness 에서는 _t_fail 미정의라 건너뜀)
if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-run-panel" || exit 1
fi
