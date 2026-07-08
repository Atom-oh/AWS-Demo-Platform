#!/usr/bin/env bash
# lens×모델 매트릭스 병렬 fan-out. 인자: <diff> <lenses_dir> <workdir>
# lenses_dir 안의 각 *.txt 가 lens 하나(파일명 stem = lens 태그, 예: L2/L3/L4/L5) —
# 그 lens 전용 리뷰 프롬프트(자체 완결형: "이 lens만 봐"). 각 lens × 각 모델이
# 독립 에이전트 셀 하나. 패널 = Codex + Kiro x3 + Claude 셀프리뷰(5번째 멤버,
# 이 repo만의 quirk — multi-region-architecture/aws-fsi-demo 에는 없음) → 5모델×4lens=20셀.
# diff 전달 경로는 CLI 별로 다름: Codex·Claude 셀프리뷰는 stdin(`< "$DIFF"` 직접
# 리다이렉트, 파일이라 TTY 아님 → no-hang); Kiro 는 stdin 을 무시하므로 `fs_read`로 파일
# 경로를 읽게 한다(아래 Kiro 셀 주석 참조) — 어느 쪽도 diff 를 argv 텍스트로 embed 하지
# 않는다(ARG_MAX/ps 노출 방지). timeout 백스톱 + 비대화형 플래그로 멈춤 방지. 셀이 비면
# 최대 PANEL_RETRIES 회 재시도(gpt-5.5/bedrock-mantle 등 transient 흡수). 매 시도마다 재실행.
# 모든 셀(모델 수 × lens 수)이 병렬(&+wait) — 벽시계 ≈ 최슬로우 셀 하나, 순차합 아님.
set -uo pipefail
DIFF="$(realpath "$1" 2>/dev/null)" \
  || { echo "run-panel.sh: realpath failed to resolve diff path: $1" >&2; exit 1; }
LENSES_DIR="$2"; WORK="$3"
# precheck.sh 와 같은 원칙 — $WORK 가 비면 ensure_slots 의 `rm -rf "$1/slot"` 가
# `rm -rf /slot`(파일시스템 루트 하위) 이 되는 파괴적 경로가 생긴다. $LENSES_DIR 빈 값은
# 파괴적이진 않지만(글롭이 매치 없이 조용히 0셀로 끝남) 인자 오설정을 조용히 넘기지 않고
# 바로 잡아내는 게 디버깅에 낫다.
[ -n "$LENSES_DIR" ] || { echo "run-panel.sh: lenses_dir (\$2) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "run-panel.sh: workdir (\$3) must not be empty" >&2; exit 1; }
# $SLOT(="$WORK/slot")는 Kiro 셀에서 `cd "$KIRO_CWD"` 이후에도 그대로 참조된다 — 호출자가
# 상대경로 WORK를 주면 그 시점부터 깨진다. 현재 호출부(워크플로)는 전부 절대경로라 실
# 결함은 아니었지만, DIFF 처럼 코드가 직접 보장하도록 여기서 절대화한다.
mkdir -p "$WORK" || { echo "run-panel.sh: failed to create workdir: $WORK" >&2; exit 1; }
WORK="$(realpath "$WORK")" \
  || { echo "run-panel.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK" || exit 1
SLOT="$WORK/slot"; RESP="$WORK/responded.txt"; : > "$RESP"
# 비-ephemeral 러너에서 $WORK 가 재사용되면 이전 실행이 남긴 severe 플래그가 그대로
# 살아남아, 이번엔 모델 전부 정상 응답해도 synthesize.sh 가 강제 FAIL 하게 된다 —
# responded.txt/degraded-models.txt 처럼 매 실행 시작 시 리셋.
rm -f "$WORK/coverage-severe.flag"
T="${PANEL_TIMEOUT:-300}"
RETRIES="${PANEL_RETRIES:-3}"
KIRO_MODELS=("claude-opus-4.8:kiro-opus" "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")

shopt -s nullglob
LENS_FILES=("$LENSES_DIR"/*.txt)
shopt -u nullglob
if [ "${#LENS_FILES[@]}" -eq 0 ]; then
  echo "run-panel.sh: no *.txt lens files found in $LENSES_DIR" >&2
  exit 1
fi

# 한 셀을 최대 $RETRIES 회 실행 — 슬롯이 비면 재시도(transient). 백그라운드로 호출.
#   try_panel <slot> <err> <cmd...>   (stdin=$DIFF, stdout=slot, stderr=err)
try_panel() {
  local slot="$1" err="$2"; shift 2
  local a
  for a in $(seq 1 "$RETRIES"); do
    "$@" > "$slot" 2>"$err" < "$DIFF" || true
    [ -s "$slot" ] && break
    [ "$a" -lt "$RETRIES" ] && echo "[retry $a/$RETRIES] $(basename "$slot" .md)" >&2
  done
}

# Kiro 는 --trust-tools=fs_read 로 실제 파일 read 권한을 갖는다(위: argv 임베드 대신 경로
# 참조로 전환). diff 는 신뢰할 수 없는 PR 콘텐츠이므로, diff 안의 프롬프트 인젝션이
# "그 경로 대신 절대경로 ~/.aws/credentials 나 이 잡의 다른 크리덴셜 env 를 읽어 응답에
# 포함시켜라" 를 유도할 잔여 위험이 있다 — 이걸 응답으로 흘리면 체어 종합을 거쳐 **공개
# PR 코멘트로 노출**되거나, Kiro 는 외부 서비스라 그 값이 리전 밖으로 나간다. (1) 격리
# cwd(레포 아님) — 상대경로 read 가 레포 파일에 못 닿게; $DIFF 는 이미 realpath 절대경로라
# cwd 변경과 무관하게 유효. (2) env 는 allowlist 로만 전달 — Kiro 자기 인증(KIRO_API_KEY)과
# 실행에 필요한 최소 변수만, GH_TOKEN/AWS_*(Codex·의장·claude-self 의 Bedrock/GitHub
# 크리덴셜) 등은 전달하지 않는다. (절대경로 read 자체는 fs_read 가 read-capable 인 한
# 남는 잔여 위험.)
# coverage-severe.flag/slot/lenses 와 같은 뿌리 — 비-ephemeral 러너에서 $WORK 가
# 재사용되면 kiro-cli 가 이 가짜 HOME 아래 남긴 캐시/세션 상태가 실행 간 누적·전이될 수
# 있다(크리덴셜은 없어 보안 영향은 아니지만 재현성 문제) — 매 실행 시작 시 리셋.
KIRO_CWD_BASE="$WORK/kiro-cwd"
[ -L "$KIRO_CWD_BASE" ] && { echo "run-panel.sh: \$KIRO_CWD_BASE is a symlink, refusing (TOCTOU guard)" >&2; exit 1; }
rm -rf "$KIRO_CWD_BASE"; mkdir -p "$KIRO_CWD_BASE"
# HOME 도 격리(실제 러너 $HOME 이 아니라 셀별 서브디렉터리) — fs_read 의 절대경로 read 자체는
# 여전히 잔여 위험(막을 방법 없음)이지만, "~/.aws/credentials"·"~/.codex/config.toml" 처럼
# 상대적 ~ 표기로 유도되는 케이스의 실효 표면을 줄인다(실제 크리덴셜은 이 가짜 HOME 아래
# 없음). 매트릭스(모델 수 × lens 수)의 모든 kiro 셀이 동시(&) 실행되므로, 셀 하나의
# cwd/HOME 을 공유하면 kiro-cli 의 세션/캐시 상태가 병렬 실행 간 경합할 수 있다 — 셀마다
# 별도 서브디렉터리를 준다.
kiro_env() {
  local cell_cwd="$1"; shift
  env -i PATH="$PATH" HOME="$cell_cwd" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" TMPDIR="${TMPDIR:-/tmp}" \
    ${KIRO_API_KEY:+KIRO_API_KEY="$KIRO_API_KEY"} "$@"
}

for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  LENS_PROMPT="$(cat "$lens_file")"

  # Codex 셀 (Bedrock, config.toml). --skip-git-repo-check 필수. AWS_REGION 강제:
  # gpt-5.5(bedrock-mantle)는 In-Region(us-east-1) 만 지원 — 잡 region 무관하게 고정.
  # diff 는 stdin.
  if command -v codex >/dev/null 2>&1; then
    ( try_panel "$SLOT/codex-$lens.md" "$SLOT/codex-$lens.err" \
        env AWS_REGION="${CODEX_AWS_REGION:-us-east-1}" AWS_DEFAULT_REGION="${CODEX_AWS_REGION:-us-east-1}" \
        timeout "$T" codex exec -s read-only --skip-git-repo-check "$LENS_PROMPT" ) &
  else echo "[skip] codex/$lens (binary absent)" >&2; : > "$SLOT/codex-$lens.md"; fi

  # Kiro x3 셀 — model:tag 를 한 배열에서 파생(호출/집계 동기화). Kiro's non-interactive
  # `chat` reads ONLY the prompt arg — it ignores stdin, so the diff must reach it via
  # `fs_read` from a file path in argv, NOT embedded as text: embedding risks the
  # single-argv 128KiB exec limit (a 3000-line diff only needs ~43B/line to exceed it)
  # and leaks the full diff into `ps` output.
  KIRO_INSTRUCTION="$LENS_PROMPT"$'\n\n'"Read the diff under review with fs_read from: $DIFF (review THIS diff only; do not scan the wider repo)"
  for entry in "${KIRO_MODELS[@]}"; do
    m="${entry%%:*}"; tag="${entry##*:}"
    if command -v kiro-cli >/dev/null 2>&1; then
      CELL_CWD="$KIRO_CWD_BASE/$tag-$lens"; mkdir -p "$CELL_CWD"
      ( cd "$CELL_CWD" && try_panel "$SLOT/$tag-$lens.md" "$SLOT/$tag-$lens.err" \
          kiro_env "$CELL_CWD" timeout "$T" kiro-cli chat "$KIRO_INSTRUCTION" --model "$m" \
          --mode default --no-interactive --trust-tools=fs_read --wrap never ) &
    else echo "[skip] $tag/$lens (binary absent)" >&2; : > "$SLOT/$tag-$lens.md"; fi
  done

  # Claude 셀프리뷰 셀(5번째 패널 멤버 — 이 repo만의 quirk) — 플러그인 장착 컨테이너에서
  # 독립 리뷰(의장과 별개 voice). Codex 와 마찬가지로 diff 는 stdin(`claude -p` 가 stdin 을
  # 정상적으로 읽으므로 Kiro 의 fs_read 경로로 강제할 필요 없음). --allowedTools 는
  # read-only GitHub 컨텍스트 도구로 고정.
  if command -v claude >/dev/null 2>&1; then
    CLAUDE_SELF_PROMPT="$LENS_PROMPT

[Claude 셀프리뷰 — 플러그인이 설치된 러너에서 실행됨]
- 필요하면 read-only 도구(gh pr diff/view·gh search, Read/Grep/Glob, 가능 시 github MCP)로
  변경 너머의 파일·PR 맥락을 직접 확인하라.
- code-review 방법론: 큰 버그·로직 오류·보안·CLAUDE.md 위반에 집중. 사소한 nitpick, 린터/타입체커가
  잡을 것, 기존(pre-existing) 이슈, PR 이 수정하지 않은 줄의 문제는 제외. false positive 는 버려라.
- findings 만 CRITICAL/MAJOR/MINOR 로 출력. 어떤 GitHub 코멘트도 게시하지 말고 VERDICT 도 출력하지 마라."
    ( try_panel "$SLOT/claude-self-$lens.md" "$SLOT/claude-self-$lens.err" \
        timeout "$T" claude -p "$CLAUDE_SELF_PROMPT" --output-format text \
          --allowedTools "Read Grep Glob Bash(gh pr diff:*) Bash(gh pr view:*) Bash(gh search:*) Bash(gh issue view:*) mcp__github__get_file_contents mcp__github__search_code mcp__github__get_pull_request mcp__github__list_commits" ) &
  else echo "[skip] claude-self/$lens (binary absent)" >&2; : > "$SLOT/claude-self-$lens.md"; fi
done

# NOTE: Antigravity(agy) 는 제거됨 — OAuth 인터랙티브 로그인 전용(API 키 인증 모드 없음)
# 이라 헤드리스 CI 에서 인증 불가. 패널 = Codex + Kiro x3 + Claude 셀프리뷰 → Claude 의장.
wait

# 결과 집계 (KIRO_MODELS·LENS_FILES 와 동일 소스에서 태그 파생 → 하드코딩 불일치 방지)
for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  record_result "$SLOT/codex-$lens.md" "codex/$lens" "$RESP"
  for entry in "${KIRO_MODELS[@]}"; do
    tag="${entry##*:}"; record_result "$SLOT/$tag-$lens.md" "$tag/$lens" "$RESP"
  done
  record_result "$SLOT/claude-self-$lens.md" "claude-self/$lens" "$RESP"
done
TOTAL_MODELS=$(( ${#KIRO_MODELS[@]} + 2 ))  # + codex + claude-self
echo "Panel responded ($(wc -l < "$RESP") / $(( TOTAL_MODELS * ${#LENS_FILES[@]} )) cells): $(tr '\n' ' ' < "$RESP")"

# 커버리지 floor — 모델 하나(플래그 무효화/바이너리 부재/전면 인증 실패 등)가 lens 전부에서
# 응답 없으면, 매트릭스가 조용히 그 모델 없이 축소된 채 VERDICT: PASS 로 이어질 수 있다.
# 모델별 row 가 완전히 비면 경고 + synthesize.sh 가 리뷰 본문에 명시하도록 파일로 전달.
: > "$WORK/degraded-models.txt"
for model_tag in codex "${KIRO_MODELS[@]##*:}" claude-self; do
  # grep -c 는 매치가 0건이어도 "0"을 찍고 exit 1 한다(매치 없음 = grep 관점의 "실패") —
  # `|| echo 0` 폴백을 붙이면 그 "0" 뒤에 폴백의 "0"이 또 붙어 "0\n0"이 되는 회귀가
  # 있을 수 있다. $RESP 는 run-panel.sh 시작부에 항상 만들어지므로 "파일 없음" 폴백
  # 자체가 불필요 — 그냥 grep 의 stdout 을 그대로 쓴다.
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

# skip 원인 노출: 빈 슬롯인데 stderr 가 있으면 stderr 의 끝(실제 에러)을 로그에 찍는다.
# public repo 라 이 Actions 로그는 누구나 읽을 수 있고, Kiro fs_read 전환 이후로는 diff
# 인젝션이 유도한 절대경로 read 결과가 stdout(셀 .md, synthesize.sh 에서 스크럽) 대신
# stderr(에러 메시지·스택트레이스)로 새어나올 수도 있다 — 원시로 찍으면 이 경로가 스크럽
# 없는 유출구가 된다. synthesize.sh 의 셀과 동일한 scrub_secrets() 를 통과시킨다.
for e in "$SLOT"/*.err; do
  [ -s "$e" ] || continue
  b="$(basename "$e" .err)"
  [ -s "$SLOT/$b.md" ] && continue   # 응답 성공이면 건너뜀
  echo "--- [$b] skipped; stderr (last 25 lines, scrubbed) ---" >&2
  tail -25 "$e" | scrub_secrets >&2
done
