#!/usr/bin/env bash
# 5개 panel job 의 artifact 를 합친 뒤(chair job 이 $WORK/slot 에 다운로드) 집계 +
# 커버리지 floor 판정. 인자: <lenses_dir> <workdir>
# run-panel.sh 는 이제 자기 모델의 셀만 알기 때문에 이 판정을 할 수 없다 — 전체 5모델
# 셋이 한 곳에 모인 뒤에만(=여기, chair job) 가능.
set -uo pipefail
LENSES_DIR="$1"; WORK="$2"
[ -n "$LENSES_DIR" ] || { echo "aggregate.sh: lenses_dir (\$1) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "aggregate.sh: workdir (\$2) must not be empty" >&2; exit 1; }
WORK="$(realpath "$WORK")" || { echo "aggregate.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
SLOT="$WORK/slot"
[ -d "$SLOT" ] || { echo "aggregate.sh: $SLOT does not exist — did download-artifact run?" >&2; exit 1; }
RESP="$WORK/responded.txt"; : > "$RESP"
rm -f "$WORK/coverage-severe.flag"

shopt -s nullglob
LENS_FILES=("$LENSES_DIR"/*.txt)
shopt -u nullglob
if [ "${#LENS_FILES[@]}" -eq 0 ]; then
  echo "aggregate.sh: no *.txt lens files found in $LENSES_DIR" >&2
  exit 1
fi

# 로스터-밖 태그 가드 — matrix.model 이 lib.sh 의 PANEL_TAGS 와 어긋나면(둘 다 개별
# 워크플로/스크립트 리터럴이라 드리프트 가능) merged slot 에 미지 태그 파일이 나타난다.
# 반대 방향(로스터엔 있는데 매트릭스가 안 돌림)은 아래 degraded-model floor 가 잡는다.
for f in "$SLOT"/*.md; do
  [ -s "$f" ] || continue
  base="$(basename "$f" .md)"
  tag="${base%-*}"
  known=0
  for t in "${PANEL_TAGS[@]}"; do [ "$tag" = "$t" ] && known=1 && break; done
  if [ "$known" -eq 0 ]; then
    echo "::error::aggregate.sh: cell '$base' has unknown model tag '$tag' — not in PANEL_TAGS (${PANEL_TAGS[*]}); matrix.model/lib.sh roster drift?" >&2
    exit 1
  fi
done

# 결과 집계 (KIRO_MODELS·LENS_FILES 와 동일 소스에서 태그 파생 → 하드코딩 불일치 방지)
for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  record_result "$SLOT/codex-$lens.md" "codex/$lens" "$RESP"
  for entry in "${KIRO_MODELS[@]}"; do
    tag="${entry##*:}"; record_result "$SLOT/$tag-$lens.md" "$tag/$lens" "$RESP"
  done
  record_result "$SLOT/claude-self-$lens.md" "claude-self/$lens" "$RESP"
done
TOTAL_MODELS=${#PANEL_TAGS[@]}
echo "Panel responded ($(wc -l < "$RESP") / $(( TOTAL_MODELS * ${#LENS_FILES[@]} )) cells): $(tr '\n' ' ' < "$RESP")"

# 커버리지 floor — 모델 하나(플래그 무효화/바이너리 부재/전면 인증 실패/그 panel job 파드
# 사망 등)가 lens 전부에서 응답 없으면, 매트릭스가 조용히 그 모델 없이 축소된 채
# VERDICT: PASS 로 이어질 수 있다. 모델별 row 가 완전히 비면 경고 + synthesize.sh 가
# 리뷰 본문에 명시하도록 파일로 전달. (job 분할의 부수 이득: panel job 하나가 죽어
# artifact 가 통째로 없어도 그 모델의 셀 전부가 결측 → 이 floor 가 그대로 잡는다.)
: > "$WORK/degraded-models.txt"
for model_tag in "${PANEL_TAGS[@]}"; do
  # grep -c 는 매치가 0건이어도 "0"을 찍고 exit 1 한다(매치 없음 = grep 관점의 "실패") —
  # `|| echo 0` 폴백을 붙이면 그 "0" 뒤에 폴백의 "0"이 또 붙어 "0\n0"이 되는 회귀가
  # 있을 수 있다. $RESP 는 위에서 항상 만들어지므로 "파일 없음" 폴백 자체가 불필요 —
  # 그냥 grep 의 stdout 을 그대로 쓴다.
  row_count="$(grep -c "^${model_tag}/" "$RESP" 2>/dev/null)"
  if [ "${row_count:-0}" -eq 0 ]; then
    echo "::warning::model '$model_tag' produced zero responses across all ${#LENS_FILES[@]} lenses — coverage degraded" >&2
    echo "$model_tag" >> "$WORK/degraded-models.txt"
  fi
done

# 심각도 상향 — degraded 모델이 (전체-1)개 이상이면 살아남은 벤더가 최대 1개뿐이라, "매트릭스
# 자체가 lens당 교차확인"이라는 warn-only 의 전제(다른 모델이 여전히 같은 lens 를 본다)가
# 성립하지 않는다. 이 경우만 severe 로 승격해 synthesize.sh 가 VERDICT 를 강제 FAIL 하도록
# 신호를 남긴다(모델 1개 탈락은 여전히 warn-only 유지 — 간헐적 rate-limit 로도 흔하고, 남은
# 모델들이 각 lens 를 여전히 교차확인하므로 이 PR 도입 시 설계한 대로 사람이 배너로만
# 인지해도 된다는 원 판단은 유효).
DEGRADED_COUNT=$(wc -l < "$WORK/degraded-models.txt")
if [ "$DEGRADED_COUNT" -ge "$((TOTAL_MODELS - 1))" ]; then
  echo "::error::coverage collapsed to ≤1 vendor ($DEGRADED_COUNT/$TOTAL_MODELS models degraded) — forcing VERDICT: FAIL, no cross-model check remains for any lens" >&2
  : > "$WORK/coverage-severe.flag"
fi

# lens 별 floor — 위 모델별 floor는 "이 모델이 모든 lens에서 죽었는가"만 본다. 반대로 한
# lens 전체(모든 모델)가 비어도 모델별 row 는 (다른 lens 응답 덕분에) 0 이 아닐 수 있어
# 위 체크를 통과한다 — 그 lens 는 아무도 리뷰하지 않았는데 매트릭스 상 정상으로 보인다.
# 모델-floor는 (전체-1)개 탈락까지 warn-only 인 반면 이건 즉시 severe인 이유: 모델 하나가
# 죽어도 그 lens 는 다른 모델들이 여전히 교차확인하지만, lens 하나가 완전히 비면 그 lens
# 는 어떤 벤더도 보지 않은 것이라 "교차확인 중 하나가 약해졌다"가 아니라 "교차확인 자체가
# 존재하지 않는다" — 완화할 대상(다른 모델의 응답)이 없어 warn-only 를 정당화할 수 없다.
: > "$WORK/degraded-lenses.txt"
for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  lens_count="$(grep -c "/${lens}$" "$RESP" 2>/dev/null)"
  if [ "${lens_count:-0}" -eq 0 ]; then
    echo "::warning::lens '$lens' produced zero responses across all models — this lens was not reviewed" >&2
    echo "$lens" >> "$WORK/degraded-lenses.txt"
    : > "$WORK/coverage-severe.flag"
  fi
done
