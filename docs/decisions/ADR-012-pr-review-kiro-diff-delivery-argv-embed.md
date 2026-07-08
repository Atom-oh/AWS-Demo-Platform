# ADR-012: PR-Review Kiro Diff Delivery — `fs_read`/`read,grep` → capped argv embed, vendor-aware severity

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-08) — amends ADR-007's Kiro tool-grant detail (`--trust-tools=read,grep`,
still the text in ADR-007's body) and its unstated successor `--trust-tools=fs_read` (the
lens×model matrix upgrade that introduced `fs_read` landed without its own ADR in this
repo). ADR-007's core decision (a multi-AI panel with a Claude chair) and ADR-011's roster/
`--v3` decision are both unaffected and remain in effect.

## Context

Kiro's diff delivery has gone through three states in this repo's history, only the first
of which ADR-007 documents: (1) `--trust-tools=read,grep` (ADR-007, since found to be
`fs_read`'s actual correct name — `read`/`grep` happened to still grant real file-read
capability, confirmed by direct reproduction against the installed `kiro-cli`), (2)
`--trust-tools=fs_read` with the diff delivered by file-path reference (undocumented
transition), (3) this ADR's change. Both (1) and (2) grant Kiro real file-read capability
against **untrusted PR diff content** — a `pull_request_target` job with self-hosted-runner
secrets in scope. A diff-borne prompt injection could instruct Kiro to read an absolute
credential path and have the value appear in its response, which the chair synthesizes into
the **public PR comment**. An AI review of the identical lens×model matrix design ported to
a sibling repo (`claude-code-usage-dashboard` PR #4) identified this class of risk as
CRITICAL and traced the same three-state history there.

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
  compared `degraded_count >= TOTAL_MODELS - 1` (4 for this repo's 5-cell roster —
  codex + 3 Kiro models + claude-self), which never tripped when a single non-Kiro vendor
  (codex or claude-self) died alone even though that left only 2 of 3 vendor *families*
  cross-checking. Corrected to: severe iff at least 2 of the 3 vendor families (codex,
  kiro-as-a-whole, claude-self) are fully dead — i.e. at most 1 vendor family survives.
- The Dockerfile's `kiro-cli chat --help` flag-support gate (added in ADR-011) checks for
  the `--trust-tools` flag's presence, not its value, so it remains valid unchanged.
- Scope: **CI pr-review only**. co-agent's own Kiro fan-out is unaffected.

## Consequences

- Closes the file-read exfiltration path structurally instead of narrowing it via env/cwd
  isolation alone.
- Trades one bounded, signaled limitation (diffs over `KIRO_DIFF_CAP` get prefix-only Kiro
  coverage, now visible via a banner) for one closed, unbounded one.
- ADR-007 should be read alongside this ADR and ADR-011 for the panel's full current state;
  its own body still describes the now-superseded `read,grep` flag and should not be edited
  per this repo's convention of leaving accepted ADRs as historical record.

## References

- `scripts/pr-review/run-panel.sh`, `lib.sh`, `synthesize.sh`
- ADR-007 (original panel decision; tool-grant detail amended by this ADR)
- ADR-011 (roster/`--v3` decision; unaffected, still in effect)
- `claude-code-usage-dashboard` PR #4 (source of the finding)
- oh-my-cloud-skills ADR-013 (the original design's own version of this decision)

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-08) — ADR-007의 Kiro 툴-그랜트 세부사항(`--trust-tools=read,grep`, ADR-007
본문에 아직 그대로 있음)과 그 뒤를 이었으나 이 repo에 별도 ADR 없이 도입된
`--trust-tools=fs_read`를 개정한다. ADR-007의 핵심 결정(Claude 의장 + 멀티-AI 패널)과
ADR-011의 로스터/`--v3` 결정은 영향받지 않고 그대로 유효하다.

## Context

이 repo에서 Kiro의 diff 전달은 세 단계를 거쳤는데, ADR-007은 그중 첫 단계만 기술한다:
(1) `--trust-tools=read,grep`(ADR-007 — 이후 실제 올바른 이름은 `fs_read`로 밝혀졌으나,
`read`/`grep` 자체도 실제로 파일 read 권한을 그랜트함을 직접 재현으로 확인), (2)
`--trust-tools=fs_read` + 파일 경로 참조로 diff 전달(이 repo에 별도 ADR 없이 도입된
전환), (3) 이 ADR의 변경. (1)과 (2) 모두 **신뢰할 수 없는 PR diff 콘텐츠**를 상대로
Kiro에 실제 파일 read 권한을 준다 — self-hosted 러너 시크릿이 스코프에 있는
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
  `degraded_count >= TOTAL_MODELS - 1`(이 repo의 5셀 로스터 기준 4)을 비교해, codex나
  claude-self 중 하나만 단독으로 죽어도 실제로는 3개 벤더 패밀리 중 2개만 남는데도
  걸리지 않았다. 3개 벤더 패밀리(codex, kiro 전체, claude-self) 중 2개 이상이 완전히
  죽어야(=최대 1개 생존) severe로 교정.
- Dockerfile의 `kiro-cli chat --help` 플래그 지원 게이트(ADR-011에서 추가)는
  `--trust-tools` 플래그의 존재 여부만 확인하고 값은 안 보므로 그대로 유효.
- 스코프: **CI pr-review only**. co-agent 자체의 Kiro fan-out은 영향 없음.

## Consequences

- env/cwd 격리만으로 좁히던 파일-read exfiltration 경로를 구조적으로 닫음.
- 하나의 bounded·신호화된 제약(`KIRO_DIFF_CAP` 초과 diff는 Kiro가 prefix만 보되 배너로
  노출)을 대가로 하나의 닫힌·무제한 제약(임의 경로 read)을 없앰.
- ADR-007은 이 ADR·ADR-011과 함께 읽어야 패널의 현재 전체 상태를 알 수 있다 — 본문은
  여전히 superseded된 `read,grep` 플래그를 기술하며, 이 repo의 관례(승인된 ADR은
  historical record로 유지)상 편집하지 않는다.

## References

- `scripts/pr-review/run-panel.sh`, `lib.sh`, `synthesize.sh`
- ADR-007(원 패널 결정; 이 ADR이 툴-그랜트 세부사항을 개정)
- ADR-011(로스터/`--v3` 결정; 영향 없음, 그대로 유효)
- `claude-code-usage-dashboard` PR #4(발견 근거)
- oh-my-cloud-skills ADR-013(원 설계 자신의 동일 결정 버전)
