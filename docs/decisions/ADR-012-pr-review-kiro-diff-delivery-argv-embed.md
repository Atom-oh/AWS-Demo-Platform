# ADR-012: PR-Review Kiro Diff Delivery — `fs_read`/`read,grep` → capped argv embed, vendor-aware severity

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-08) — amends ADR-007's Kiro tool-grant detail (`--trust-tools=read,grep`,
still the text in ADR-007's original body) and its unstated successor `--trust-tools=fs_read`
(the lens×model matrix upgrade that introduced `fs_read` landed without a documented change
in this repo at the time). ADR-007's core decision (a multi-AI panel with a Claude chair)
and ADR-011 (roster `kimi-k2.5`→`gpt-5.5`, drop `--v3` — the live source of truth for the
Kiro roster/CLI flags, which landed on `main` shortly before this ADR was drafted) are both
unaffected and remain in effect: ADR-011's own Decision changed `--trust-tools=fs_read` to
the *tool name*, not whether Kiro gets any tool grant at all, which is the narrower thing
this ADR changes.

## Context

Kiro's diff delivery has gone through three states in this repo's history, only the first
of which ADR-007 documents: (1) `--trust-tools=read,grep` (ADR-007, since found to be
`fs_read`'s actual correct name — `read`/`grep` happened to still grant real file-read
capability, confirmed by direct reproduction against the installed `kiro-cli`), (2)
`--trust-tools=fs_read` with the diff delivered by file-path reference (a transition this
repo has no dedicated ADR for — ADR-011 fixed the adjacent roster/`--v3` problem in the
same script without touching the tool-grant line), (3) this ADR's change. Both (1) and (2)
grant Kiro real file-read capability against **untrusted PR diff content** — a
`pull_request_target` job with self-hosted-runner secrets in scope. A diff-borne prompt
injection could instruct Kiro to read an absolute credential path and have the value appear
in its response, which the chair synthesizes into the **public PR comment**. An AI review of
the identical lens×model matrix design ported to a sibling repo (`claude-code-usage-dashboard`
PR #4) identified this class of risk as CRITICAL and traced the same three-state history
there.

## Decision

- `scripts/pr-review/run-panel.sh`: Kiro cells receive `--trust-tools=` (empty — grants no
  tools at all) instead of `--trust-tools=fs_read`. Verified live against the real
  `kiro-cli chat --help`: `"trust no tools: '--trust-tools='"` is the documented syntax,
  confirmed further by direct reproduction (an injected "read /etc/passwd" instruction is
  refused, not executed, under `--trust-tools=`).
- The diff is capped (`KIRO_DIFF_CAP`, default 100000B — safely under the kernel's
  `MAX_ARG_STRLEN` ~128KiB per-argument limit) and embedded directly into the `chat`
  argument for all Kiro cells, replacing the file-path reference.
- **Coverage-signal gap closed in the same pass**: a diff exceeding `KIRO_DIFF_CAP` left
  Kiro cells reviewing only a truncated prefix with no signal. `run-panel.sh` now emits
  `::warning::` and a `$WORK/kiro-diff-truncated.flag`; `synthesize.sh` surfaces it as an
  advisory banner. In this repo's 3-vendor panel (codex, kiro, claude-self), codex and
  claude-self both still see the full diff via stdin when only Kiro is truncated.
- **Coverage-severe gate corrected from model-count to vendor-count**: the prior gate
  compared `degraded_count >= TOTAL_MODELS - 1` (4 for this repo's 5-model roster —
  codex + 3 Kiro models + claude-self, 20 review cells total across 4 lenses). Concrete
  miss: if codex and claude-self both die simultaneously (2 of 5 models, none of them
  Kiro), `degraded_count` is only 2 — nowhere near the old threshold of 4 — so the old gate
  stayed warn-only even though 2 of the 3 vendor *families* were fully dead and only Kiro's
  own cross-checking of itself remained. Corrected to: severe iff at least 2 of the 3
  vendor families (codex, kiro-as-a-whole, claude-self) are fully dead — i.e. at most 1
  vendor family survives. A single vendor family dying alone (e.g. codex alone) is
  unchanged as warn-only — the other two families still cross-check every lens, which is
  the scenario this design intentionally treats as non-severe.
- **`lib.sh`'s `record_result()` is now exit-status-aware**: it previously counted a cell
  as "responded" whenever its slot file was non-empty, so a CLI that wrote partial output
  before crashing (non-zero exit) was miscounted as a real response. `try_panel()` now
  captures the actual exit code to a `.rc` sidecar file per attempt; `record_result()`
  requires both non-empty output *and* exit code 0.
- The Dockerfile's `kiro-cli chat --help` flag-support gate — rewritten by ADR-011 to drop
  `--v3` (`/tmp/kiro-chat-help`, not `/tmp/kiro-v3-chat-help`) — checked only the
  `--trust-tools` flag's presence, not its documented semantics. This ADR additionally
  strengthens it to grep for the exact `"trust no tools: '--trust-tools='"` help text, so
  a future weekly rebuild that silently changes what an empty value means fails the build
  instead of silently reintroducing the tool-grant this ADR closes.
- `lib.sh`'s `scrub_secrets()` comment is corrected to stop overstating scope: removing
  Kiro's tool grant closes the absolute-path-read vector **for Kiro specifically**, but
  codex (`-s read-only` sandbox, i.e. real file-read) and the claude-self panelist
  (`Read`/`Grep`/`Glob` tools) both still have genuine file-read capability against the
  same untrusted diff — for those two, `scrub_secrets()` remains the primary defense, not
  an already-closed backstop.
- Scope: **CI pr-review only**. co-agent's own Kiro fan-out is unaffected.

## Consequences

- Closes the Kiro file-read exfiltration path structurally instead of narrowing it via
  env/cwd isolation alone — but codex and claude-self retain genuine file-read tools
  against the same untrusted diff, so `scrub_secrets()` remains load-bearing for those two,
  not merely residual (see `lib.sh` comment fix above).
- Trades one bounded, signaled limitation (diffs over `KIRO_DIFF_CAP` get prefix-only Kiro
  coverage, now visible via a banner) for one closed, unbounded one.
- ADR-007 and ADR-011 should both be read alongside this ADR for the panel's full current
  state; ADR-007's body/rationale still describes the now-superseded `read,grep` flag and
  is left unedited per this repo's convention (ADR-008/ADR-009 precedent: the *rationale*
  of an accepted ADR stays historical record) — but per that same precedent, ADR-007's
  **Status** line gets a breadcrumb noting both the ADR-011 and this ADR's amendments.

## References

- `scripts/pr-review/run-panel.sh`, `lib.sh`, `synthesize.sh`
- `docker/actions-runner-claude/Dockerfile` (kiro-cli flag-semantics gate, strengthened)
- `.github/workflows/pr-review.yml` (`pull_request_target` — the untrusted-diff threat
  model this ADR's decision is scoped to)
- ADR-007 (original panel decision; tool-grant detail amended by this ADR)
- ADR-011 (live source of truth for the Kiro roster/`--v3` decision; unaffected by this ADR
  — its own tool-grant-name fix, `fs_read`, is what this ADR further narrows to no grant)
- `claude-code-usage-dashboard` PR #4 (source of the finding)
- oh-my-cloud-skills ADR-013 (the original design's own version of this decision)

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-08) — ADR-007의 Kiro 툴-그랜트 세부사항(`--trust-tools=read,grep`, ADR-007
원문 본문에 아직 그대로 있음)과 그 뒤를 이었으나 당시엔 별도 기록 없이 도입된
`--trust-tools=fs_read`를 개정한다. ADR-007의 핵심 결정(Claude 의장 + 멀티-AI 패널)과
ADR-011(로스터 `kimi-k2.5`→`gpt-5.5`, `--v3` 제거 — Kiro 로스터/CLI 플래그의 현행
source of truth이며, 이 ADR을 작성하기 직전에 main에 머지됨)은 둘 다 영향받지 않고
그대로 유효하다: ADR-011 자신의 Decision은 `--trust-tools=fs_read`의 *툴 이름*을
바꿨을 뿐, Kiro에 아예 툴을 안 주느냐는 이 ADR이 다루는 더 좁은 범위와는 별개다.

## Context

이 repo에서 Kiro의 diff 전달은 세 단계를 거쳤는데, ADR-007은 그중 첫 단계만 기술한다:
(1) `--trust-tools=read,grep`(ADR-007 — 이후 실제 올바른 이름은 `fs_read`로 밝혀졌으나,
`read`/`grep` 자체도 실제로 파일 read 권한을 그랜트함을 직접 재현으로 확인), (2)
`--trust-tools=fs_read` + 파일 경로 참조로 diff 전달(이 repo에 전용 ADR이 없는 전환 —
ADR-011이 같은 스크립트의 인접한 로스터/`--v3` 문제를 고쳤지만 이 tool-grant 줄은
건드리지 않았다), (3) 이 ADR의 변경. (1)과 (2) 모두 **신뢰할 수 없는 PR diff 콘텐츠**를
상대로 Kiro에 실제 파일 read 권한을 준다 — self-hosted 러너 시크릿이 스코프에 있는
`pull_request_target` job이다. diff에 심어진 프롬프트 인젝션이 절대경로 크리덴셜을
읽게 유도하고 그 값이 응답에 실리면, 체어가 이를 종합해 **공개 PR 코멘트**에 남긴다.
동일한 lens×model 매트릭스 설계를 포팅한 sibling repo(`claude-code-usage-dashboard`
PR #4)의 AI 리뷰가 이 위험 계열을 CRITICAL로 지적하며 같은 3단계 히스토리를 추적했다.

## Decision

- `scripts/pr-review/run-panel.sh`: Kiro 셀은 `--trust-tools=fs_read` 대신
  `--trust-tools=`(빈 값 — 툴 미부여)를 받는다. `kiro-cli chat --help`의 공식 문서
  ("trust no tools: '--trust-tools='")로 확인했고, 직접 재현(주입된 "read /etc/passwd"
  지시가 `--trust-tools=` 하에서 거부됨)으로도 재확인했다.
- diff 는 캡핑(`KIRO_DIFF_CAP`, 기본 100000B — 커널 `MAX_ARG_STRLEN`(~128KiB) 한도
  아래로 안전)되어 모든 Kiro 셀의 `chat` argument 에 직접 embed 된다(경로 참조 대체).
- **같은 패스에서 커버리지 신호 공백도 해소**: `KIRO_DIFF_CAP`을 넘는 diff는 Kiro 셀이
  prefix만 리뷰하는데도 신호가 없었다. `run-panel.sh`가 이제 `::warning::` +
  `$WORK/kiro-diff-truncated.flag`를 남기고, `synthesize.sh`가 배너로 노출한다. 이
  repo의 3-벤더 패널(codex, kiro, claude-self)에서는 Kiro만 잘려도 codex·claude-self는
  stdin으로 전체 diff를 계속 본다.
- **coverage-severe 게이트를 모델-개수 축에서 벤더-개수 축으로 교정**: 옛 조건은
  `degraded_count >= TOTAL_MODELS - 1`(이 repo의 5-모델 로스터 기준 4 — codex + kiro
  모델 3개 + claude-self, lens 4개 × 5모델 = 총 20개 리뷰 셀)을 비교했다. 구체적 누락
  사례: codex와 claude-self가 동시에 죽어도(kiro는 무관, 전체 5모델 중 2개만 죽음)
  `degraded_count`는 2에 불과해 옛 임계값 4에 한참 못 미치므로, 실제로는 3개 벤더
  패밀리 중 2개가 완전히 죽어 kiro 혼자만 자기 자신을 교차확인하는 상태인데도 옛
  게이트는 여전히 warn-only였다. 3개 벤더 패밀리(codex, kiro 전체, claude-self) 중
  2개 이상이 완전히 죽어야(=최대 1개 생존) severe로 교정. 벤더 하나만 단독으로 죽는
  경우(예: codex만)는 여전히 warn-only로 변경 없음 — 나머지 두 패밀리가 모든 lens를
  계속 교차확인하므로, 이 설계가 의도적으로 non-severe로 취급하는 시나리오다.
- **`lib.sh`의 `record_result()`가 exit-status까지 본다**: 이전에는 slot 파일이
  비어있지 않으면 "응답함"으로 집계했는데, 그러면 부분 출력을 남기고 crash한(exit
  비정상) CLI 도 정상 응답으로 잘못 집계됐다. `try_panel()`이 매 시도의 실제 exit code를
  `.rc` 사이드카 파일에 남기고, `record_result()`는 비어있지 않음 **AND** exit code 0을
  모두 요구한다.
- Dockerfile의 `kiro-cli chat --help` 플래그 지원 게이트 — ADR-011이 `--v3`를 빼도록
  다시 쓴 바로 그 블록(`/tmp/kiro-v3-chat-help`가 아니라 `/tmp/kiro-chat-help`)은
  지금까지 `--trust-tools` 플래그의 존재 여부만 확인하고 그 시맨틱은 안 봤다. 이 ADR이
  여기에 `"trust no tools: '--trust-tools='"` 정확한 문구까지 grep 하도록 강화해, 향후
  주간 재빌드에서 kiro-cli가 이 의미를 조용히 바꿔도 빌드가 fail-closed 되게 한다.
- `lib.sh`의 `scrub_secrets()` 주석이 범위를 과대 서술하던 것을 정정: Kiro 의 tool
  grant 제거는 절대경로 read 벡터를 **Kiro 에 한해서만** 닫는다. codex(`-s read-only`
  샌드박스도 실제 파일 read 가능)와 claude-self 패널원(`Read`/`Grep`/`Glob` 허용)은
  여전히 같은 untrusted diff 를 상대로 진짜 파일-read 능력을 갖고 있어, 이 둘에게는
  `scrub_secrets()`가 이미 닫힌 경로의 부수적 방어선이 아니라 지금도 주 방어선이다.
- 스코프: **CI pr-review only**. co-agent 자체의 Kiro fan-out은 영향 없음.

## Consequences

- Kiro 의 파일-read exfiltration 경로를 env/cwd 격리만으로 좁히던 것에서 구조적으로
  닫는 것으로 바꿨다 — 그러나 codex 와 claude-self 는 같은 untrusted diff 를 상대로
  여전히 진짜 파일-read 툴을 갖고 있으므로, 이 둘에게는 `scrub_secrets()`가 여전히
  load-bearing이다(부수적이 아님 — 위 `lib.sh` 주석 수정 참조).
- 하나의 bounded·신호화된 제약(`KIRO_DIFF_CAP` 초과 diff는 Kiro가 prefix만 보되 배너로
  노출)을 대가로 하나의 닫힌·무제한 제약(임의 경로 read)을 없앰.
- ADR-007과 ADR-011 둘 다 이 ADR과 함께 읽어야 패널의 현재 전체 상태를 알 수 있다 —
  ADR-007 본문/rationale은 여전히 superseded된 `read,grep` 플래그를 기술하며, 이
  repo의 관례(ADR-008/ADR-009 전례: 승인된 ADR의 *rationale*은 historical record로
  유지)상 편집하지 않는다. 다만 같은 전례에 따라 ADR-007의 **상태(Status)** 줄에는
  ADR-011과 이 ADR 둘 다의 개정 breadcrumb를 추가한다.

## References

- `scripts/pr-review/run-panel.sh`, `lib.sh`, `synthesize.sh`
- `docker/actions-runner-claude/Dockerfile`(kiro-cli 플래그-시맨틱 게이트, 강화됨)
- `.github/workflows/pr-review.yml`(`pull_request_target` — 이 ADR의 결정이 스코프로
  삼는 untrusted-diff threat model)
- ADR-007(원 패널 결정; 이 ADR이 툴-그랜트 세부사항을 개정)
- ADR-011(Kiro 로스터/`--v3` 결정의 현행 source of truth; 이 ADR과 무관 — ADR-011
  자신의 툴-그랜트-이름 수정(`fs_read`)을 이 ADR이 "툴 미부여"로 더 좁힌다)
- `claude-code-usage-dashboard` PR #4(발견 근거)
- oh-my-cloud-skills ADR-013(원 설계 자신의 동일 결정 버전)
