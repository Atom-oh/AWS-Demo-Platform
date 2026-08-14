# ADR-011: PR-Review Kiro Roster — `kimi-k2.5` → `gpt-5.5`, Drop `--v3`

## Status

Accepted (2026-07-08) — amends ADR-016's Kiro roster (`claude-opus-4.8`/`kimi-k2.5`/`glm-5`)
and its `--v3` usage decision. ADR-016's Context/Options/mermaid diagram are left as
historical record; this ADR is the live source of truth for the roster and CLI flags. Note:
this ADR landed alongside the lens×model matrix upgrade (`scripts/pr-review/run-panel.sh`,
undocumented by its own ADR in this repo) — the roster/flag fix below applies to that
current (lens-aware, `fs_read`-based) implementation, not the flat single-prompt panel
ADR-016 originally described.

**Amended (PR #63)**: the `fs_read`-based diff delivery described below was itself
superseded — Kiro cells now get **no** tool grant (`--trust-tools=`, empty) and the diff
is embedded directly as capped argv text instead. See PR #63 review for the rationale
(prompt-injection-driven absolute-path credential read via `fs_read`). The roster/`--v3`
decision below is unaffected; only the `--trust-tools=fs_read` references are stale.

**Amended in part by [ADR-013](ADR-013-pr-review-gpt56-model-bump.md)** (2026-07-15): the
`gpt-5.5` roster slot below is stale — bumped to `gpt-5.6-sol` (Codex's own model) /
`gpt-5.6-terra` (Kiro's roster slot). ADR-013 is the live source of truth for those ids;
everything else in this ADR (roster structure, `--v3` drop) is unaffected.

## Context

`kimi-k2.5` was flagged in ADR-016 itself as a risk ("may be account-tier gated → silent
skip") and production evidence confirmed it: coverage degradation and unsupported/
hallucinated findings observed across sibling repos running the same panel design (see
oh-my-cloud-skills ADR-012 for the detailed cross-repo evidence this repo shares the
underlying `scripts/pr-review/*` design with).

An earlier fix attempt swapped to `minimax-m2.5` after `gpt-5.5` appeared to fail with
`HTTP 400 INVALID_MODEL_ID` via `kiro-cli --v3 chat --model gpt-5.5`. Direct testing found
the actual cause: **`--v3` itself**, not `gpt-5.5`, routes to a narrower-catalog backend
that rejects the model. `kiro-cli chat --model gpt-5.5` (no `--v3`) works. `--v3` was
originally adopted (per ADR-016 line "Kiro v3") for reasons unrelated to model support and
is not load-bearing for anything this panel currently depends on.

## Decision

- `scripts/pr-review/run-panel.sh`: `KIRO_MODELS=("claude-opus-4.8:kiro-opus"
  "gpt-5.5:kiro-gpt" "glm-5:kiro-glm")` — no `minimax-m2.5`.
- `kiro-cli chat` invocations drop `--v3` (current invocation:
  `--mode default --no-interactive --trust-tools= --wrap never` — no tool grant; the
  lens×matrix upgrade's diff delivery is capped argv-embed, not `fs_read`, per PR #63).
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
