# ADR-014: PR-Review Anthropic Model Bump — `claude-opus-4.8` → `claude-opus-5`

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-28) — amends ADR-011's Kiro roster (`claude-opus-4.8`/`gpt-5.6-terra`/`glm-5`,
after ADR-013's GPT bump) and the chair fallback ADR-007 introduced. ADR-007/011/013's
Context/Decision are left as historical record; this ADR is the live source of truth for the
Anthropic model ids used in the panel.

## Context

Claude Opus 5 is available in both places this panel depends on — but at **different
maturity levels**, which matters for how much this ADR should be leaned on:

- Bedrock `us-east-1`: **GA** — `us.anthropic.claude-opus-5` and `global.anthropic.claude-opus-5`
  both `ACTIVE` in `aws bedrock list-inference-profiles`. This is the chair's path.
- Kiro's model catalog (`kiro-cli chat --list-models`): **listed, but labelled "Experimental
  preview of Claude Opus 5 model with 1M context window"** — not GA on Kiro's side. Priced at
  `2.20x` credits, the same rate as `claude-opus-4.8`, so the bump costs nothing extra. This is
  the `kiro-opus` panel cell's path, and the preview label is the reason the last Consequence
  below keeps a re-verify note instead of treating the id as stable.

Two independent slots in the panel still pinned `claude-opus-4.8`:

- Kiro's first roster slot (`scripts/pr-review/run-panel.sh`'s `KIRO_MODELS`, tagged
  `claude-opus-4.8:kiro-opus`).
- The chair's fallback model (`scripts/pr-review/synthesize.sh`'s `FALLBACK_MODEL`, used when
  the primary `claude-fable-5` chair call fails/times out/returns no `VERDICT`).

The chair *primary* (`us.anthropic.claude-fable-5`) is unchanged — ADR-007's chair-model
choice isn't being revisited here, only the fallback and the Kiro slot.

Separately, the runner image (`docker/actions-runner-claude/`) ships `@anthropic-ai/claude-code`
itself, installed via the vendor `latest` script with no version pin — same pattern as
ADR-013 noted for the CLIs. It already tracks the latest release on every weekly rebuild
(confirmed live: the cron build that fired 2026-07-25 18:00 UTC — i.e. 2026-07-26 03:00 KST,
the "Sun 03:00 KST" slot — baked `claude-code 2.1.220`, matching current npm `latest` as of
this ADR) — no code change was needed for that slot.

## Decision

- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.6-terra:kiro-gpt" "glm-5:kiro-glm")` → `"claude-opus-5:kiro-opus"`. Tag (`kiro-opus`)
  unchanged, so the aggregation/degraded-model logic keyed on the tag needs no other edits.
- `scripts/pr-review/synthesize.sh`: `FALLBACK_MODEL` default `us.anthropic.claude-opus-4-8` →
  `us.anthropic.claude-opus-5`.
- `scripts/pr-review/synthesize.sh`'s `chair_label()`: `*opus-4-8*` case → `*opus-5*` (matched
  after the `*fable-5*` case, so `us.anthropic.claude-fable-5` still resolves correctly).
- `CLAUDE.md` / `docs/architecture.md` PR-review summary lines updated to match.

## Consequences

- **Both ids were smoke-tested live before merge**: `kiro-cli chat --model claude-opus-5
  --mode default --no-interactive --trust-tools= --wrap never "Reply with exactly: OK"`
  returned `OK`; `aws bedrock list-inference-profiles --region us-east-1` lists
  `us.anthropic.claude-opus-5` as `ACTIVE`. `chair_label us.anthropic.claude-opus-5` was
  verified to print `Claude Opus 5` (not fall through to the raw-id `*)` branch).
- Both edited files (`run-panel.sh`, `synthesize.sh`) are read from the repo checkout at job
  run time — unlike `config.toml` (baked into the runner image), this change takes effect
  **immediately on merge**, no image rebuild needed.
- Unrelated to this ADR: the runner image itself didn't need a rebuild for this change — it
  was already rebuilt by the weekly cron that fired 2026-07-25 18:00 UTC with current
  `claude-code`/`kiro-cli`/`codex` releases baked in. The next firing is 2026-08-01 18:00 UTC
  = **2026-08-02 03:00 KST (Sun)** — the cron is `0 18 * * 6`, so the UTC date is always the
  Saturday and the KST date the following Sunday; do not label the UTC date with the KST
  weekday.
- If Bedrock/Kiro later drop `claude-opus-4.8` entirely, no further action is needed here —
  this ADR already moved both slots off it. If `claude-opus-5` turns out to be a short-lived
  preview id (as Kiro's catalog description hints — "Experimental preview" — similar to
  `gpt-5.5`/`gpt-5.6-*` in ADR-013), the next bump should re-verify both slots independently.

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-28) — ADR-011의 Kiro 로스터(`claude-opus-4.8`/`gpt-5.6-terra`/`glm-5`,
ADR-013의 GPT 교체 이후)와 ADR-007이 도입한 chair fallback을 개정한다. ADR-007/011/013의
Context/Decision은 historical record로 남기고, 이 ADR이 패널이 쓰는 Anthropic 모델 id의
현행 source of truth다.

## Context

Claude Opus 5는 이 패널이 의존하는 두 경로 모두에서 사용 가능하지만 **성숙도가 다르다** —
이 ADR을 어디까지 신뢰할지에 영향을 주므로 구분해 적는다:

- Bedrock `us-east-1`: **GA** — `us.anthropic.claude-opus-5`·`global.anthropic.claude-opus-5`
  모두 `aws bedrock list-inference-profiles`에서 `ACTIVE`. 의장이 쓰는 경로다.
- Kiro 모델 카탈로그(`kiro-cli chat --list-models`): **등재돼 있으나 "Experimental preview of
  Claude Opus 5 model with 1M context window"로 표기** — Kiro 쪽은 GA가 아니다. 단가는
  `2.20x`로 `claude-opus-4.8`과 동일해 추가 비용은 없다. `kiro-opus` 패널 셀이 쓰는 경로이며,
  아래 마지막 Consequence가 id를 안정적인 것으로 취급하지 않고 재검증 노트를 남겨두는 이유다.

패널의 독립된 두 슬롯이 여전히 `claude-opus-4.8`을 고정하고 있었다:

- Kiro 로스터 1번째 슬롯(`scripts/pr-review/run-panel.sh`의 `KIRO_MODELS`,
  `claude-opus-4.8:kiro-opus` 태그).
- Chair fallback 모델(`scripts/pr-review/synthesize.sh`의 `FALLBACK_MODEL`, primary
  `claude-fable-5` 호출이 실패/타임아웃/`VERDICT` 없음일 때 사용).

Chair *primary*(`us.anthropic.claude-fable-5`)는 그대로다 — ADR-007의 chair 모델 선택
자체를 재검토하는 ADR이 아니라, fallback과 Kiro 슬롯만 다룬다.

별개로, 러너 이미지(`docker/actions-runner-claude/`)가 굽는 `@anthropic-ai/claude-code`
자체는 vendor `latest` 스크립트로 설치되며 버전 핀이 없다 — ADR-013이 CLI들에 대해 지적한
패턴과 동일. 매 주간 재빌드마다 이미 최신 릴리스를 자동으로 따라간다(실측:
2026-07-25 18:00 UTC에 발화한 cron 빌드(= 2026-07-26 03:00 KST, "일 03:00 KST" 슬롯)가
`claude-code 2.1.220`을 baking했고, 이 ADR 작성 시점 npm `latest`와 동일) — 이 슬롯은 코드 변경이 필요 없었다.

## Decision

- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.6-terra:kiro-gpt" "glm-5:kiro-glm")` → `"claude-opus-5:kiro-opus"`. 태그(`kiro-opus`)는
  그대로라 태그 기준 집계/degraded-model 로직은 추가 수정 불필요.
- `scripts/pr-review/synthesize.sh`: `FALLBACK_MODEL` 기본값 `us.anthropic.claude-opus-4-8` →
  `us.anthropic.claude-opus-5`.
- `scripts/pr-review/synthesize.sh`의 `chair_label()`: `*opus-4-8*` 케이스 → `*opus-5*`
  (`*fable-5*` 케이스 다음에 매치되므로 `us.anthropic.claude-fable-5`는 여전히 정상 resolve).
- `CLAUDE.md` / `docs/architecture.md`의 PR-review 요약 문구도 함께 갱신.

## Consequences

- **두 id 모두 머지 전 라이브 스모크 테스트를 마쳤다**: `kiro-cli chat --model claude-opus-5
  --mode default --no-interactive --trust-tools= --wrap never "Reply with exactly: OK"`가
  `OK`를 반환; `aws bedrock list-inference-profiles --region us-east-1`에서
  `us.anthropic.claude-opus-5`가 `ACTIVE`로 조회됨. `chair_label us.anthropic.claude-opus-5`가
  `Claude Opus 5`를 출력함(raw-id `*)` 브랜치로 떨어지지 않음)도 확인.
- 수정된 두 파일(`run-panel.sh`, `synthesize.sh`)은 job 실행 시점에 repo 체크아웃에서
  읽힌다 — `config.toml`(러너 이미지에 baking)과 달리 **머지 즉시** 발효되며 이미지
  재빌드가 필요 없다.
- 이 ADR과 무관: 이 변경을 위해 러너 이미지 재빌드가 필요하지 않았다 — 2026-07-25 18:00 UTC에
  발화한 주간 cron이 이미 현재 `claude-code`/`kiro-cli`/`codex` 릴리스를 baking해 재빌드해뒀다.
  다음 발화는 2026-08-01 18:00 UTC = **2026-08-02 03:00 KST(일)**. cron 이 `0 18 * * 6`이므로
  UTC 날짜는 항상 토요일, KST 날짜는 그 다음 일요일이다 — UTC 날짜에 KST 요일 라벨을 붙이지 말 것.
- Bedrock/Kiro가 나중에 `claude-opus-4.8`을 완전히 제거해도 추가 조치 불필요 — 이 ADR이
  이미 두 슬롯 모두 그 밖으로 옮겼다. `claude-opus-5`가 (Kiro 카탈로그 설명의 "Experimental
  preview" 문구처럼) 단명 preview id로 끝나면, ADR-013의 `gpt-5.5`/`gpt-5.6-*`처럼 다음
  교체 때 두 슬롯을 각각 독립적으로 재검증해야 한다.
