#!/usr/bin/env bash
# aggregate.sh 단위 테스트. harness(run-all.sh 가 source) + standalone 모두 지원.
# ADR-015(per-model 병렬 job 분리)로 run-panel.sh 에서 빠져나온 집계/커버리지 floor 판정
# (responded.txt, degraded-models.txt, degraded-lenses.txt, coverage-severe.flag) 을
# 검증한다 — chair job 이 5개 panel artifact 를 $WORK/slot 에 합친 뒤 이 스크립트를 부른다.
# 순수 파일 기반이라 LLM/CLI 모킹이 필요 없다.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/aggregate.sh"

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

setup() { # $1 = lens 태그 목록(공백 구분, 기본 "L2 L3")
  WORK=$(mktemp -d); LENSES=$(mktemp -d)
  mkdir -p "$WORK/slot"
  for l in ${1:-L2 L3}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}
fill() { # $1 model_tag $2 lens $3 content(비면 empty file)
  local f="$WORK/slot/$1-$2.md"
  if [ -n "${3:-}" ]; then echo "$3" > "$f"; else : > "$f"; fi
}

# (a) 5모델×2lens 전원 응답 — degraded 전무, severe 없음, responded=10
setup "L2 L3"
for m in codex kiro-opus kiro-gpt kiro-glm claude-self; do
  for l in L2 L3; do fill "$m" "$l" "finding"; done
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
[ "$(wc -l < "$WORK/responded.txt" 2>/dev/null || echo 0)" = 10 ] \
  && pass "aggregate (a) responded=10 (5 models x 2 lenses)" || fail "aggregate (a) responded=10 (5 models x 2 lenses)" "responded != 10"
{ [ -f "$WORK/degraded-models.txt" ] && [ ! -s "$WORK/degraded-models.txt" ]; } \
  && pass "aggregate (a) no degraded models" || fail "aggregate (a) no degraded models" "degraded-models.txt non-empty"
[ ! -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (a) no coverage-severe" || fail "aggregate (a) no coverage-severe" "flag unexpectedly set"

# (b) kiro-glm 하나만 전멸(panel job 파드 사망 시뮬레이션: 그 모델 파일이 아예 없음) —
# 나머지 4모델은 각 lens 를 여전히 교차확인 → warn-only, severe 승격 안 됨
setup "L2 L3"
for m in codex kiro-opus kiro-gpt claude-self; do
  for l in L2 L3; do fill "$m" "$l" "finding"; done
done
# kiro-glm-*.md 는 파일 자체가 없음(artifact 자체가 안 올라온 상황) — 빈 파일도 두지 않음
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "kiro-glm" "$WORK/degraded-models.txt" 2>/dev/null \
  && pass "aggregate (b) kiro-glm flagged degraded (missing artifact = missing model)" \
  || fail "aggregate (b) kiro-glm flagged degraded (missing artifact = missing model)" "not in degraded-models.txt"
[ ! -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (b) not severe (4/5 vendors still respond)" || fail "aggregate (b) not severe (4/5 vendors still respond)" "flag unexpectedly set"

# (c) 4모델 결측(1모델만 생존) — severe 로 승격
setup "L2"
fill codex L2 "finding"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (c) coverage-severe forced (only 1/5 vendor alive)" \
  || fail "aggregate (c) coverage-severe forced (only 1/5 vendor alive)" "flag not set"

# (d) 한 lens 전체가 무응답(다른 lens 는 정상) — 모델별 floor 는 통과하지만 lens floor 가 즉시 severe
setup "L2 L3"
for m in codex kiro-opus kiro-gpt kiro-glm claude-self; do
  fill "$m" "L2" "finding"
  fill "$m" "L3" ""   # L3 는 전원 빈 응답
done
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
grep -qx "L3" "$WORK/degraded-lenses.txt" 2>/dev/null \
  && pass "aggregate (d) L3 flagged as fully-degraded lens" || fail "aggregate (d) L3 flagged as fully-degraded lens" "not in degraded-lenses.txt"
[ -f "$WORK/coverage-severe.flag" ] \
  && pass "aggregate (d) lens collapse forces coverage-severe immediately" \
  || fail "aggregate (d) lens collapse forces coverage-severe immediately" "flag not set despite empty lens"

# (e) 로스터-밖 태그 — matrix.model/lib.sh 드리프트 가드, 조용히 넘기지 않고 즉시 실패
setup "L2"
fill codex L2 "finding"
fill "totally-unknown-model" L2 "finding"
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "aggregate (e) unknown model tag in slot fails loudly" || fail "aggregate (e) unknown model tag in slot fails loudly" "exited 0 with unknown tag present"

# (f) lenses_dir 비어있으면 즉시 실패
setup "L2"; rm -f "$LENSES"/*.txt
"$SCRIPT" "$LENSES" "$WORK" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "aggregate (f) empty lenses_dir fails loudly" || fail "aggregate (f) empty lenses_dir fails loudly" "exited 0 with no lens files"

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-aggregate" || exit 1
fi
