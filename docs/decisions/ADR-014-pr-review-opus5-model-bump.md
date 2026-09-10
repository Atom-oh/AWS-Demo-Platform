# ADR-014: PR-Review Anthropic Model Bump — `claude-opus-4.8` → `claude-opus-5`

## Status

Accepted (2026-07-28) — amends ADR-011's Kiro roster (`claude-opus-4.8`/`gpt-5.6-terra`/`glm-5`,
after ADR-013's GPT bump) and the chair fallback ADR-016 introduced. ADR-016/011/013's
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

The chair *primary* (`us.anthropic.claude-fable-5`) is unchanged — ADR-016's chair-model
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

> **Update (2026-09-09):** the chair *primary* — explicitly untouched by this ADR's original
> Decision — is bumped: `us.anthropic.claude-fable-5` → `global.anthropic.claude-fable-5-1`
> (`scripts/pr-review/synthesize.sh`'s `PRIMARY_MODEL` default, and the `claude-self` panel
> job's `ANTHROPIC_MODEL` in `.github/workflows/pr-review.yml`). The chair *fallback* also
> moves from the region-pinned `us.` prefix to `global.`: `us.anthropic.claude-opus-5` →
> `global.anthropic.claude-opus-5` (both `ACTIVE` per this ADR's own original verification).
> Kiro's roster slot (`KIRO_MODELS` in `scripts/pr-review/lib.sh`) moves
> `claude-fable-5:kiro-fable` → `claude-fable-5.1:kiro-fable` — Kiro's catalog names this
> model with a dot (`claude-fable-5.1`, confirmed live via `kiro-cli chat --list-models`),
> not the hyphenated Bedrock inference-profile ID; the two catalogs using different alias
> spellings for related models is already established precedent, not a typo (see the
> `gpt-5.6-sol`/`gpt-5.6-terra` note in ADR-013/ADR-015). `synthesize.sh`'s `chair_label()`
> gained a `*fable-5-1*` case (checked before the pre-existing `*fable-5*` case) so the new
> primary still resolves to a readable label instead of falling through to the raw id.
>
> `ANTHROPIC_BEDROCK_BASE_URL` moves from `us-east-1` to `ap-northeast-2` (Seoul) — with the
> model now global, ANY region works, not specifically `us-east-1`. This does **not** mean
> `AWS_REGION` can be dropped, though: `global.` only affects Bedrock's internal routing
> *after* the request lands, not the SigV4 signing region, which must still match the
> endpoint. An initial version of this update removed `AWS_REGION` entirely, on the
> (incorrect, for this code path) assumption that a global model needs no region config at
> all — the AI review panel on the sibling-propagation PR caught the resulting endpoint/
> signing-region mismatch (cc-on-bedrock #114, L4 MAJOR) before it merged anywhere. The
> corrected, final state keeps `AWS_REGION: ap-northeast-2` matched to
> `ANTHROPIC_BEDROCK_BASE_URL`'s same region — moved as a pair, not dropped.
>
> This is distinct from the same-session "us." → "global." move made for Codex's own model
> (commit `c7a41bb`: `openai.gpt-5.6-sol` on the region-pinned `amazon-bedrock` provider →
> `global.openai.gpt-6-astra` on `amazon-bedrock-runtime`, baked into the runner image's
> `config.toml`) — Codex's `amazon-bedrock-runtime` provider genuinely has no equivalent
> region-pin requirement, so that region-pin cleanup (propagated to sibling repos'
> `run-panel.sh`) was correct as originally done and needed no follow-up correction.
