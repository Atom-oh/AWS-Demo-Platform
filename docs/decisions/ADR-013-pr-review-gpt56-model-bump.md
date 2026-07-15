# ADR-013: PR-Review GPT Model Bump — `gpt-5.5` → `gpt-5.6-sol`/`gpt-5.6-terra`

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-15) — amends ADR-011's roster (`claude-opus-4.8`/`gpt-5.5`/`glm-5` for
Kiro, `openai.gpt-5.5` for Codex's own Bedrock model). ADR-011's Context/Decision are left
as historical record; this ADR is the live source of truth for the GPT model ids.

## Context

Bedrock/OpenAI shipped `gpt-5.6` variants, replacing the `gpt-5.5` id this panel pinned in
two independent places:

- Codex's own model (`docker/actions-runner-claude/config.toml`, `model = "openai.gpt-5.5"`)
  → `openai.gpt-5.6-sol`.
- Kiro's third roster slot (`scripts/pr-review/run-panel.sh`'s `KIRO_MODELS`, tagged
  `gpt-5.5:kiro-gpt`) → `gpt-5.6-terra`.

These are **not the same model id** — Codex calls its own Bedrock-mantle model directly by
the `openai.*` Bedrock model id, while Kiro resolves `--model gpt-5.6-terra` through its own
internal catalog (which is why the two slots drifted to different `gpt-5.6-*` variants
rather than a single shared name). Neither id currently resolves via
`aws bedrock list-foundation-models`/`list-inference-profiles` in `us-east-1` — both are
bedrock-mantle marketplace routes, consistent with how `gpt-5.5` also didn't show up in
those list APIs (ADR-011 predates this ADR and never surfaced that gap either).

## Decision

- `docker/actions-runner-claude/config.toml`: `model = "openai.gpt-5.5"` →
  `model = "openai.gpt-5.6-sol"`.
- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")` → `"gpt-5.6-terra:kiro-gpt"`.
- Comments referencing the old id in `run-panel.sh`, `pr-review.yml`, and the Dockerfile
  updated to match (`gpt-5.6-sol` where the comment is about Codex's own model,
  `gpt-5.6-terra` where it's about Kiro's slot).
- `CLAUDE.md` / `docs/architecture.md` PR-review summary lines updated to match.

## Consequences

- The runner image must be rebuilt (weekly cron or on-demand — `runner-image.yml`
  `workflow_dispatch`) before this takes effect; `config.toml` is baked into the image at
  build time, so editing it here alone doesn't change an already-built image's Codex model.
- Unrelated to this ADR: `codex`/`claude-code`/`kiro-cli` themselves install via vendor
  `latest` scripts with no version pin (Dockerfile comment: "주간 빌드의 목적이 최신
  유지이므로 핀은 설계상 모순") — they already pick up upstream CLI updates on every
  rebuild with no code change needed. Only the *model ids* pinned in this repo's own files
  needed an explicit bump.
- If `gpt-5.6-sol`/`gpt-5.6-terra` turn out to be short-lived aliases (as `gpt-5.5` was
  before it), the next bump should again touch both slots independently rather than
  assuming they stay in lockstep.

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-15) — ADR-011의 로스터(Kiro `claude-opus-4.8`/`gpt-5.5`/`glm-5`, Codex
자체 Bedrock 모델 `openai.gpt-5.5`)를 개정한다. ADR-011의 Context/Decision은 historical
record로 남기고, 이 ADR이 GPT 모델 id의 현행 source of truth다.

## Context

Bedrock/OpenAI가 `gpt-5.6` 계열을 출시하면서, 이 패널이 두 곳에 독립적으로 고정해둔
`gpt-5.5` id를 교체해야 한다:

- Codex 자체 모델(`docker/actions-runner-claude/config.toml`, `model = "openai.gpt-5.5"`)
  → `openai.gpt-5.6-sol`.
- Kiro 로스터 3번째 슬롯(`scripts/pr-review/run-panel.sh`의 `KIRO_MODELS`,
  `gpt-5.5:kiro-gpt` 태그) → `gpt-5.6-terra`.

두 값은 **동일 모델 id가 아니다** — Codex는 `openai.*` Bedrock 모델 id로 자기 모델을
직접 호출하고, Kiro는 `--model gpt-5.6-terra`를 자체 내부 카탈로그로 resolve한다(그래서
두 슬롯이 공유 이름 하나가 아니라 서로 다른 `gpt-5.6-*` 계열로 분기됐다). 두 id 모두
현재 `us-east-1`의 `aws bedrock list-foundation-models`/`list-inference-profiles`로는
조회되지 않는다 — 둘 다 bedrock-mantle 마켓플레이스 경로이며, `gpt-5.5` 시절에도 그
list API들에 안 뜨던 것과 동일한 패턴이다(ADR-011은 이 ADR보다 앞서 작성됐고 그 갭을
명시한 적은 없다).

## Decision

- `docker/actions-runner-claude/config.toml`: `model = "openai.gpt-5.5"` →
  `model = "openai.gpt-5.6-sol"`.
- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")` → `"gpt-5.6-terra:kiro-gpt"`.
- `run-panel.sh`/`pr-review.yml`/Dockerfile의 옛 id 참조 주석도 함께 갱신(Codex 자체
  모델을 가리키는 곳은 `gpt-5.6-sol`, Kiro 슬롯을 가리키는 곳은 `gpt-5.6-terra`).
- `CLAUDE.md` / `docs/architecture.md`의 PR-review 요약 문구도 함께 갱신.

## Consequences

- 이 결정이 실제로 적용되려면 러너 이미지가 재빌드되어야 한다(주간 cron 또는
  `runner-image.yml`의 `workflow_dispatch` 수동 트리거) — `config.toml`은 빌드 타임에
  이미지에 baking되므로, 여기서 파일만 고쳐서는 이미 빌드된 이미지의 Codex 모델이
  바뀌지 않는다.
- 이 ADR과 무관: `codex`/`claude-code`/`kiro-cli` 자체는 vendor `latest` 스크립트로
  설치되며 버전 핀이 없다(Dockerfile 주석: "주간 빌드의 목적이 최신 유지이므로 핀은
  설계상 모순") — 이 CLI들은 재빌드마다 코드 변경 없이 자동으로 최신 버전을 받는다.
  이번에 명시적으로 손봐야 했던 건 이 repo 자체 파일에 고정된 *모델 id*뿐이다.
- `gpt-5.6-sol`/`gpt-5.6-terra`가 (`gpt-5.5`처럼) 단명 alias로 끝나면, 다음 번 교체도
  두 슬롯이 항상 lockstep으로 간다고 가정하지 말고 각각 독립적으로 확인 후 손대야 한다.
