#!/usr/bin/env bash
# 한 모델의 lens×model 셀만 실행. 인자: <diff> <lenses_dir> <workdir> <model_tag>
# model_tag: codex | kiro-fable | kiro-sol | claude-self (lib.sh PANEL_TAGS 참조)
# lenses_dir 안의 각 *.txt 가 lens 하나(파일명 stem = lens 태그, 예: L2/L3/L4/L5) —
# 그 lens 전용 리뷰 프롬프트(자체 완결형: "이 lens만 봐"). 워크플로가 모델별 병렬 job
# (matrix.model)으로 이 스크립트를 5번 부르므로, 한 호출은 그 모델의 lens 전체(4셀)만
# 실행한다 — 파드당 동시 프로세스 20 → 4, 각 job 이 자기 셀 결과만 artifact 로 올리고
# chair job 의 aggregate.sh 가 5개 artifact 를 합쳐 최종 집계/floor 판정을 한다.
# diff 전달 경로는 CLI 별로 다름: Codex·Claude 셀프리뷰는 stdin(`< "$DIFF"` 직접
# 리다이렉트, 파일이라 TTY 아님 → no-hang); Kiro 는 stdin 을 무시하고 어떤 툴도 못 받으므로
# (아래 Kiro 셀 주석 참조) size-capped argv 텍스트로 직접 embed 한다. timeout 백스톱 +
# 비대화형 플래그로 멈춤 방지. 셀이 비면 최대 PANEL_RETRIES 회 재시도(codex의
# gpt-5.6-sol/bedrock-mantle 등 transient 흡수). 매 시도마다 재실행.
# 한 모델의 lens 4개가 병렬(&+wait) — 벽시계 ≈ 최슬로우 lens 하나, 순차합 아님.
set -uo pipefail
DIFF="$(realpath "$1" 2>/dev/null)" \
  || { echo "run-panel.sh: realpath failed to resolve diff path: $1" >&2; exit 1; }
LENSES_DIR="$2"; WORK="$3"; MODEL_TAG="$4"
# precheck.sh 와 같은 원칙 — $WORK 가 비면 ensure_slots 의 `rm -rf "$1/slot"` 가
# `rm -rf /slot`(파일시스템 루트 하위) 이 되는 파괴적 경로가 생긴다. $LENSES_DIR 빈 값은
# 파괴적이진 않지만(글롭이 매치 없이 조용히 0셀로 끝남) 인자 오설정을 조용히 넘기지 않고
# 바로 잡아내는 게 디버깅에 낫다.
[ -n "$LENSES_DIR" ] || { echo "run-panel.sh: lenses_dir (\$2) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "run-panel.sh: workdir (\$3) must not be empty" >&2; exit 1; }
[ -n "$MODEL_TAG" ] || { echo "run-panel.sh: model_tag (\$4) must not be empty" >&2; exit 1; }
# $SLOT(="$WORK/slot")는 Kiro 셀에서 `cd "$CELL_CWD"` 이후에도 그대로 참조된다 — 호출자가
# 상대경로 WORK를 주면 그 시점부터 깨진다. 현재 호출부(워크플로)는 전부 절대경로라 실
# 결함은 아니었지만, DIFF 처럼 코드가 직접 보장하도록 여기서 절대화한다.
mkdir -p "$WORK" || { echo "run-panel.sh: failed to create workdir: $WORK" >&2; exit 1; }
WORK="$(realpath "$WORK")" \
  || { echo "run-panel.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK" || exit 1
SLOT="$WORK/slot"
case " ${PANEL_TAGS[*]} " in
  *" $MODEL_TAG "*) ;;
  *) echo "run-panel.sh: unknown model_tag '$MODEL_TAG' (expected one of: ${PANEL_TAGS[*]})" >&2; exit 1 ;;
esac
T="${PANEL_TIMEOUT:-300}"
RETRIES="${PANEL_RETRIES:-3}"

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

# Kiro 셀은 어떤 툴도 부여받지 않는다(`--trust-tools=`, 아래) — 이전 리비전은 `fs_read`를
# 부여해 diff 경로만 넘기고 Kiro 가 직접 읽게 했으나, 두 가지 문제가 있었다: (1) diff 는
# 신뢰할 수 없는 PR 콘텐츠라, 그 안의 프롬프트 인젝션이 "그 경로 대신 절대경로
# ~/.aws/credentials 를 읽어라"를 유도할 수 있었다(격리 cwd/HOME 으로도 절대경로 read 자체는
# 못 막음 — oh-my-cloud-skills 19차 리뷰 CRITICAL, 격리된 cwd 에서도 Kiro 가 실제로
# 절대경로 레포 파일을 읽어냄이 실증됨). (2) `fs_read` 호출 자체를 모델이 안 해도(또는
# sandbox 에 막혀도) "no findings" 류의 그럴듯한 non-empty 응답을 낼 수 있어, 커버리지
# floor(aggregate.sh)가 빈 슬롯만 탐지하는 한 diff 를 실제로 못 본 셀이 정상 응답으로 조용히
# 집계된다(cc-on-bedrock PR#107 리뷰 MAJOR-1). 툴을 아예 안 주고 diff 를 argv 로 직접
# 넘기면 두 문제가 구조적으로 함께 사라진다 — read 호출이 필요 없으니 건너뛸 수도 없고,
# 부여된 툴이 없으니 절대경로 read 경로 자체가 없다.
# `--trust-tools=`(빈 값)이 "무툴"임은 kiro-cli 자신의 공식 문서(`kiro-cli chat --help`):
# "trust no tools: '--trust-tools='" — 그대로 인용되는 예시 문구(버전: kiro-cli 2.11.1,
# 라이브 재현으로도 재확인 — 주입된 "read /etc/passwd" 지시가 거부됨). 향후 kiro-cli 가
# 이 시맨틱을 바꾸면 이 fail-closed 가정도 재검증 필요.
# 격리는 lens 마다 별도 서브디렉터리로 유지(co-agent PR 게이트의 `_review_one`/
# `_sanitized_env`와 동일 패턴) — 툴 제거와 격리는 직교한 두 결정이다: 한 모델의 lens 4개가
# 동시(&) 실행되므로, 셀 하나의 cwd/HOME 을 공유하면 kiro-cli 의 세션/캐시 상태가 병렬
# 실행 간 경합할 수 있다(fs_read 제거 리팩토링에서 "cross-run 전이 예방"으로만 재서술되며
# 이 경합 방지 목적이 소리 없이 빠졌던 회귀 — 이 PR 자체의 리뷰가 4개 모델 교차 합의로 잡음).
# 비-ephemeral 러너에서 $WORK 가 재사용돼도 매 실행 시작 시 베이스를 리셋해 이전 실행의
# kiro-cwd 상태가 새 실행에 새지 않게 한다.
KIRO_CWD_BASE="$WORK/kiro-cwd"
[ -L "$KIRO_CWD_BASE" ] && { echo "run-panel.sh: \$KIRO_CWD_BASE is a symlink, refusing (TOCTOU guard)" >&2; exit 1; }
rm -rf "$KIRO_CWD_BASE"; mkdir -p "$KIRO_CWD_BASE"
kiro_env() {
  local cell_cwd="$1"; shift
  env -i PATH="$PATH" HOME="$cell_cwd" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" TMPDIR="${TMPDIR:-/tmp}" \
    ${KIRO_API_KEY:+KIRO_API_KEY="$KIRO_API_KEY"} "$@"
}

# diff 는 size-capped argv 텍스트로 직접 embed — 단일 argv 128KiB 커널 한도(MAX_ARG_STRLEN)
# 아래로 캡한다. argv 임베드를 원래 피했던 이유(그 한도, `ps` 노출)는 여기선 실질적
# 트레이드오프가 아니다: (1) PANEL_CELL_CAP 캡핑 관례를 diff 입력에도 그대로 적용해 한도
# 아래로 자르고, (2) 이 diff 는 public repo 의 PR diff 라 이미 GitHub 에 공개돼 있으므로
# `ps` 가시성이 새로운 기밀 노출이 아니다(공식 secret 이 아님). Kiro 태그일 때만 준비.
KIRO_TAG=""
for entry in "${KIRO_MODELS[@]}"; do
  [ "${entry##*:}" = "$MODEL_TAG" ] && KIRO_TAG="$MODEL_TAG" && KIRO_MODEL_ID="${entry%%:*}"
done

if [ -n "$KIRO_TAG" ]; then
  KIRO_DIFF_CAP="${KIRO_DIFF_CAP:-100000}"
  KIRO_DIFF_TEXT="$(head -c "$KIRO_DIFF_CAP" "$DIFF")"
  # truncation 자체는 무해(대형 diff 의 의도된 트레이드오프)하지만, 신호 없이 넘어가면 Kiro
  # 셀은 prefix 만 보고도 정상 응답으로 집계돼 "벤더 하나가 diff 일부만 보면 coverage 신호를
  # 남긴다"는 계약을 조용히 어긴다 — synthesize.sh 가 리뷰 본문에 명시하도록 플래그 파일로 전달.
  if [ "$(wc -c < "$DIFF")" -gt "$KIRO_DIFF_CAP" ]; then
    KIRO_DIFF_TEXT+=$'\n[...TRUNCATED at '"$KIRO_DIFF_CAP"'B — full diff not sent to Kiro...]'
    echo "::warning::diff exceeds KIRO_DIFF_CAP (${KIRO_DIFF_CAP}B) — Kiro cells only see a truncated prefix" >&2
    # $SLOT 안에 둔다(예전엔 $WORK 루트) — panel job 이 artifact 로 올리는 건 $SLOT 디렉터리
    # 하나뿐이라, 이 플래그가 $SLOT 밖에 있으면 존재 여부에 따라 upload-artifact 의 LCA(least
    # common ancestor)가 달라져 매 실행마다 아티팩트 내부 구조가 바뀐다(PR#88 리뷰 CRITICAL —
    # 진단: diff 가 KIRO_DIFF_CAP 이하인 보통 케이스엔 이 파일이 전혀 없어 LCA 가 $SLOT 자체로
    # 붕괴, chair 의 aggregate.sh 가 $SLOT 을 못 찾고 매 실행 실패). $SLOT 안에 두면 항상 같은
    # 디렉터리 하나만 올리므로 존재 여부와 무관하게 구조가 고정된다.
    : > "$SLOT/kiro-diff-truncated.flag"
  fi
fi

for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  LENS_PROMPT="$(cat "$lens_file")"

  # case 대신 if/elif — kiro 분기를 태그 리스트로 다시 나열하면(예전 `kiro-fable|kiro-sol)`)
  # KIRO_MODELS 의 사본이 하나 더 생긴다. 로스터에 3번째 Kiro 모델을 추가하면 이 사본이
  # 어느 arm 에도 안 걸려 그 모델 셀이 조용히 0개가 되는 회귀가 있었다(PR#88 리뷰 MINOR) —
  # 위에서 이미 KIRO_MODELS 를 순회해 파생해 둔 $KIRO_TAG(빈 문자열이면 이 태그가 Kiro가
  # 아니라는 뜻)로만 분기해 로스터 사본을 하나 없앤다.
  if [ "$MODEL_TAG" = codex ]; then
    # Codex 셀 (Bedrock, config.toml). --skip-git-repo-check 필수. AWS_REGION 강제:
    # gpt-5.6-sol(bedrock-mantle)는 In-Region(us-east-1) 만 지원 — 잡 region 무관하게 고정.
    # diff 는 stdin.
    if command -v codex >/dev/null 2>&1; then
      ( try_panel "$SLOT/codex-$lens.md" "$SLOT/codex-$lens.err" \
          env AWS_REGION="${CODEX_AWS_REGION:-us-east-1}" AWS_DEFAULT_REGION="${CODEX_AWS_REGION:-us-east-1}" \
          timeout "$T" codex exec -s read-only --skip-git-repo-check "$LENS_PROMPT" ) &
    else echo "[skip] codex/$lens (binary absent)" >&2; : > "$SLOT/codex-$lens.md"; fi
  elif [ -n "$KIRO_TAG" ]; then
    # Kiro 셀. Kiro's non-interactive `chat` reads ONLY the prompt arg — it ignores stdin,
    # so diff 는 argv 에 직접 embed(캡됨, 툴 미부여 — 위 KIRO_DIFF_TEXT/`--trust-tools=` 주석 참조).
    KIRO_INSTRUCTION="$LENS_PROMPT"$'\n\n'"Review ONLY the diff below; do not read or reference any other files:"$'\n\n'"$KIRO_DIFF_TEXT"
    if command -v kiro-cli >/dev/null 2>&1; then
      CELL_CWD="$KIRO_CWD_BASE/$MODEL_TAG-$lens"; mkdir -p "$CELL_CWD"
      ( cd "$CELL_CWD" && try_panel "$SLOT/$MODEL_TAG-$lens.md" "$SLOT/$MODEL_TAG-$lens.err" \
          kiro_env "$CELL_CWD" timeout "$T" kiro-cli chat "$KIRO_INSTRUCTION" --model "$KIRO_MODEL_ID" \
          --mode default --no-interactive --trust-tools= --wrap never ) &
    else echo "[skip] $MODEL_TAG/$lens (binary absent)" >&2; : > "$SLOT/$MODEL_TAG-$lens.md"; fi
  elif [ "$MODEL_TAG" = claude-self ]; then
    # Claude 셀프리뷰 셀(패널 4번째 멤버 — 이 repo만의 quirk) — 플러그인 장착 컨테이너에서
    # 독립 리뷰(의장과 별개 voice). Codex 와 마찬가지로 diff 는 stdin(`claude -p` 가 stdin 을
    # 정상적으로 읽으므로 Kiro 의 fs_read 경로로 강제할 필요 없음). --allowedTools 는
    # read-only GitHub 컨텍스트 도구로 고정.
    if command -v claude >/dev/null 2>&1; then
      CLAUDE_SELF_PROMPT="$LENS_PROMPT

[Claude self-review — running on the plugin-equipped runner]
- If needed, use read-only tools (gh pr diff/view, gh search, Read/Grep/Glob, github MCP
  where available) to check files/PR context beyond the diff directly.
- code-review methodology: focus on real bugs, logic errors, security, CLAUDE.md violations.
  Exclude minor nitpicks, anything a linter/type-checker would catch, pre-existing issues, and
  problems on lines the PR didn't touch. Discard false positives.
- Output findings only, grouped CRITICAL/MAJOR/MINOR. Do not post any GitHub comment and do
  not output a VERDICT line.
Respond in English only (token/context efficiency — do not mix in other languages)."
      ( try_panel "$SLOT/claude-self-$lens.md" "$SLOT/claude-self-$lens.err" \
          timeout "$T" claude -p "$CLAUDE_SELF_PROMPT" --output-format text \
            --allowedTools "Read Grep Glob Bash(gh pr diff:*) Bash(gh pr view:*) Bash(gh search:*) Bash(gh issue view:*) mcp__github__get_file_contents mcp__github__search_code mcp__github__get_pull_request mcp__github__list_commits" ) &
    else echo "[skip] claude-self/$lens (binary absent)" >&2; : > "$SLOT/claude-self-$lens.md"; fi
  fi
done

# NOTE: Antigravity(agy) 는 제거됨 — OAuth 인터랙티브 로그인 전용(API 키 인증 모드 없음)
# 이라 헤드리스 CI 에서 인증 불가. 패널 = Codex + Kiro x3 + Claude 셀프리뷰 → Claude 의장.
wait

# 집계(responded.txt/degraded-*/coverage-severe)는 여기서 하지 않는다 — 이 스크립트는 한
# 모델의 셀만 알기 때문. 5개 병렬 job 전체가 끝난 뒤 chair job 이 artifact 를 합쳐
# aggregate.sh 로 판정한다.

# skip 원인 노출: 빈 슬롯인데 stderr 가 있으면 stderr 의 끝(실제 에러)을 로그에 찍는다.
# public repo 라 이 Actions 로그는 누구나 읽을 수 있다 — synthesize.sh 의 셀과 동일한
# scrub_secrets() 를 통과시켜 stderr(에러 메시지·스택트레이스) 경로로 새어나올 수 있는
# 우발적 크리덴셜 노출을 막는다.
for e in "$SLOT"/*.err; do
  [ -s "$e" ] || continue
  b="$(basename "$e" .err)"
  [ -s "$SLOT/$b.md" ] && continue   # 응답 성공이면 건너뜀
  echo "--- [$b] skipped; stderr (last 25 lines, scrubbed) ---" >&2
  tail -25 "$e" | scrub_secrets >&2
done
