#!/usr/bin/env bash
# run-panel.sh 단위 테스트. harness(run-all.sh 가 source) + standalone 모두 지원.
# 실제 CLI 대신 PATH 모킹으로 (a)codex 태그 응답 (b)kiro-sol 태그 응답·형제 kiro 태그 미간섭
# (c)claude-self 재시도 소진 후 빈 슬롯(비차단) (d)미지 모델 태그 거부 (e)빈 lenses_dir 거부를
# 검증한다 — "전원실패" 검증은 이제 한 모델짜리 호출 범위 밖(aggregate.sh 의 커버리지 floor
# 소관, test-aggregate.sh 참조).
#
# per-model 병렬 job 분리(ADR-015)로 인자/책임이 바뀜: 4번째 인자 <model_tag> 로 한 모델의
# lens 전체(4셀)만 실행하고, responded.txt/degraded-*/coverage-severe 집계는 더 이상
# 여기서 하지 않는다(4개 병렬 job 이 끝난 뒤 chair job 의 aggregate.sh 가 담당 —
# test-aggregate.sh 참조). 이 파일은 "한 모델 호출이 자기 lens 셀만 정확히 만드는지"만 본다.
# 로스터(lib.sh): codex, kiro-fable(claude-fable-5), kiro-sol(gpt-5.6-sol), claude-self.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/run-panel.sh"

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

# (a) codex 태그 — 2 lens(L2,L3), codex 만 셀을 만들고 kiro/claude-self 슬롯은 안 건드림
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

# (b) kiro-sol 태그 — 모델 자체가 gpt-5.6-sol 로 kiro-cli 를 부르는지(kiro-fable 과 혼동 없이)
setup; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-sol >/dev/null 2>&1
[ -s "$WORK/slot/kiro-sol-L2.md" ] \
  && pass "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" || fail "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" "slot missing/empty"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] \
  && pass "run-panel (b) sibling kiro tag untouched" || fail "run-panel (b) sibling kiro tag untouched" "kiro-fable slot appeared"

# (c) claude-self 태그, CLI 가 매번 실패(exit 1) — PANEL_RETRIES 소진 후 빈 슬롯, 비차단.
# (실제 미설치 바이너리 케이스는 이 러너 환경에 시스템 `claude` CLI 가 PATH 에 이미 있어
# $BIN 프리펜드만으로는 재현이 안 된다 — 실패 종료코드로 "응답 없음" 경로를 동일하게 검증.)
setup; mkfake claude 1 ""
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && [ -f "$WORK/slot/claude-self-L2.md" ] && [ ! -s "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" \
  || fail "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" "rc=$rc"

# (d) 로스터 밖 model_tag는 즉시 실패 — matrix.model 오타/드리프트를 조용히 넘기지 않는다
setup
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" not-a-real-model >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (d) unknown model_tag fails loudly" || fail "run-panel (d) unknown model_tag fails loudly" "exited 0 with unknown tag"

# (e) lenses_dir 에 *.txt 가 없으면 인자 오설정으로 간주하고 즉시 실패(0셀로 조용히 넘어가지 않음)
setup; rm -f "$LENSES"/*.txt; mkfake codex 0 "codex-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (e) empty lenses_dir fails loudly" || fail "run-panel (e) empty lenses_dir fails loudly" "exited 0 with no lens files"

# standalone 종료코드 (harness 에서는 _t_fail 미정의라 건너뜀)
if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-run-panel" || exit 1
fi
