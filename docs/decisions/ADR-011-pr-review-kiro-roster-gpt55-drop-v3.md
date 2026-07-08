# ADR-011: PR-Review Kiro Roster — `kimi-k2.5` → `gpt-5.5`, Drop `--v3`

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-08) — amends ADR-007's Kiro roster (`claude-opus-4.8`/`kimi-k2.5`/`glm-5`)
and its `--v3` usage decision. ADR-007's Context/Options/mermaid diagram are left as
historical record; this ADR is the live source of truth for the roster and CLI flags. Note:
this ADR landed alongside the lens×model matrix upgrade (`scripts/pr-review/run-panel.sh`,
undocumented by its own ADR in this repo) — the roster/flag fix below applies to that
current (lens-aware, `fs_read`-based) implementation, not the flat single-prompt panel
ADR-007 originally described.

## Context

`kimi-k2.5` was flagged in ADR-007 itself as a risk ("may be account-tier gated → silent
skip") and production evidence confirmed it: coverage degradation and unsupported/
hallucinated findings observed across sibling repos running the same panel design (see
oh-my-cloud-skills ADR-012 for the detailed cross-repo evidence this repo shares the
underlying `scripts/pr-review/*` design with).

An earlier fix attempt swapped to `minimax-m2.5` after `gpt-5.5` appeared to fail with
`HTTP 400 INVALID_MODEL_ID` via `kiro-cli --v3 chat --model gpt-5.5`. Direct testing found
the actual cause: **`--v3` itself**, not `gpt-5.5`, routes to a narrower-catalog backend
that rejects the model. `kiro-cli chat --model gpt-5.5` (no `--v3`) works. `--v3` was
originally adopted (per ADR-007 line "Kiro v3") for reasons unrelated to model support and
is not load-bearing for anything this panel currently depends on.

## Decision

- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")` — no `minimax-m2.5`.
- `kiro-cli chat` invocations drop `--v3` (current invocation:
  `--mode default --no-interactive --trust-tools=fs_read --wrap never`, per the lens×matrix
  upgrade's `fs_read`-based diff delivery).
- `docker/actions-runner-claude/Dockerfile`'s build-time flag-support gate now checks
  `kiro-cli chat --help` (no `--v3`), matching what the panel actually invokes.
- `CLAUDE.md` / `docs/architecture.md` PR-review summary lines updated to match.

## Consequences

- Restores 3-vendor roster diversity (Claude/OpenAI/Zhipu) instead of two Claude-family
  slots.
- The runner image must be rebuilt (weekly cron or on-demand) before this takes effect —
  the Dockerfile gate change alone doesn't retroactively re-validate an already-built image.
- Sibling repos running the same ported CI design received the same roster + `--v3` fix;
  see oh-my-cloud-skills ADR-012 for the full cross-repo rationale and evidence.

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-08) — ADR-007의 Kiro 로스터(`claude-opus-4.8`/`kimi-k2.5`/`glm-5`)와
`--v3` 사용 결정을 개정한다. ADR-007의 Context/Options/mermaid 다이어그램은 historical
record로 남기고, 이 ADR이 로스터·CLI 플래그의 현행 source of truth다. 참고: 이 ADR은
lens×model 매트릭스 업그레이드(`scripts/pr-review/run-panel.sh`, 이 repo에는 별도 ADR
없음)와 함께 반영됐다 — 아래 로스터/플래그 수정은 ADR-007이 원래 기술한 단일-프롬프트
평면 패널이 아니라 현재의(lens-aware, `fs_read` 기반) 구현에 적용된다.

## Context

`kimi-k2.5`는 ADR-007 자체에서 이미 리스크("계정 등급 제한 가능 → silent skip")로
지적됐고, 프로덕션 근거가 이를 확인했다: 같은 패널 설계를 공유하는 sibling repo들에서
커버리지 저하와 근거 없는/할루시네이션 지적이 관측됐다(자세한 리포간 근거는
oh-my-cloud-skills ADR-012 참조 — `scripts/pr-review/*` 설계를 공유하는 원본 근거다).

이전 수정 시도는 `kiro-cli --v3 chat --model gpt-5.5`가 `HTTP 400 INVALID_MODEL_ID`로
실패해 보여 `minimax-m2.5`로 교체했다. 직접 테스트로 실제 원인을 찾았다: `gpt-5.5`
자체가 아니라 **`--v3` 플래그 자체**가 더 좁은 모델 카탈로그를 가진 별도 백엔드로
라우팅해 해당 모델을 거부한 것이다. `kiro-cli chat --model gpt-5.5`(`--v3` 없이)는
정상 동작한다. `--v3`는 원래(ADR-007의 "Kiro v3" 문구) 모델 지원과 무관한 이유로
채택됐고, 현재 이 패널이 의존하는 어떤 것에도 필수적이지 않다.

## Decision

- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")` — `minimax-m2.5`는 최종적으로 없음.
- `kiro-cli chat` 호출에서 `--v3` 제거(현재 호출: `--mode default --no-interactive
  --trust-tools=fs_read --wrap never` — lens×매트릭스 업그레이드의 `fs_read` 기반 diff
  전달 방식).
- `docker/actions-runner-claude/Dockerfile`의 빌드 타임 플래그 검증 게이트를
  `kiro-cli chat --help`(no `--v3`)로 변경 — 패널이 실제로 호출하는 것과 일치시킴.
- `CLAUDE.md` / `docs/architecture.md`의 PR-review 요약 문구도 함께 갱신.

## Consequences

- 3-벤더 로스터 다양성(Claude/OpenAI/Zhipu) 회복 — 이전처럼 Claude 계열 2슬롯이
  아니게 됨.
- 이 결정이 실제로 적용되려면 러너 이미지가 재빌드되어야 한다(주간 cron 또는 수동) —
  Dockerfile 게이트만 바꾼다고 이미 빌드된 이미지가 소급 재검증되지는 않는다.
- 같은 CI 설계를 포팅한 sibling repo들도 동일한 로스터 + `--v3` 수정을 받음 — 리포간
  전체 근거는 oh-my-cloud-skills ADR-012 참조.
