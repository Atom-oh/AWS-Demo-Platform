# ADR-013: PR-Review GPT Model Bump — `gpt-5.5` → `gpt-5.6-sol`/`gpt-5.6-terra`

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

- **Both ids were smoke-tested live before merge** (locally, ahead of the PR-review panel
  flagging this as unverified): `kiro-cli chat --model gpt-5.6-terra --mode default
  --no-interactive --trust-tools= --wrap never "Reply with exactly: OK"` returned `OK`;
  `codex exec -s read-only --skip-git-repo-check -c model=openai.gpt-5.6-sol "Reply with
  exactly: OK"` (Bedrock, `amazon-bedrock` provider) also returned `OK`. Local `~/.codex/config.toml`
  additionally already lists `"openai.gpt-5.6-sol" = 4` under `[tui.model_availability_nux]`,
  consistent with the id being live.
- The two slots take effect at different times: `KIRO_MODELS` is read from the repo checkout,
  so it takes effect **immediately on merge**; `config.toml` is baked into the runner image at
  build time, so the Codex slot only takes effect **after the next image rebuild** (weekly
  cron or on-demand `runner-image.yml` `workflow_dispatch`) — editing it here alone doesn't
  change an already-built image's Codex model.
- Unrelated to this ADR: `codex`/`claude-code`/`kiro-cli` themselves install via vendor
  `latest` scripts with no version pin (Dockerfile comment: "the point of a weekly build is
  staying current, so pinning would be a design contradiction") — they already pick up upstream CLI updates on every
  rebuild with no code change needed. Only the *model ids* pinned in this repo's own files
  needed an explicit bump.
- If `gpt-5.6-sol`/`gpt-5.6-terra` turn out to be short-lived aliases (as `gpt-5.5` was
  before it), the next bump should again touch both slots independently rather than
  assuming they stay in lockstep.
