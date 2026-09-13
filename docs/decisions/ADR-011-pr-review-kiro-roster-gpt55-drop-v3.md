# ADR-011: Kiro catalog route and removal of --v3

## Status

Accepted (2026-07-08). The no-`--v3` decision remains applicable. Original model IDs
were amended by ADR-013, ADR-014 and ADR-015; use the
[current workflow map](../pr-review.md) for configured values. This ADR does not
supersede ADR-016's panel/chair architecture or runner ownership.

## Context and decision

The original `kimi-k2.5` slot had unreliable coverage. A trial of `gpt-5.5` returned
`INVALID_MODEL_ID` through `kiro-cli --v3 chat`; the same model worked through
`kiro-cli chat`. The observed failure was specific to that CLI route, not evidence
that Bedrock or every Kiro route rejected the model.

On 2026-07-08 the panel replaced `kimi-k2.5` with `gpt-5.5`, retained the then-current
Opus/GLM slots, and removed `--v3`. The Dockerfile's flag-support check was changed
to match the invoked command. These model names describe that decision's history,
not the current roster.

## Later amendments

- PR #63 removed Kiro file-read grants after an absolute-path credential-read risk.
  Kiro received an argv-embedded diff with `--trust-tools=` and isolated HOME/cwd;
  the explicit `inline-review` profile later replaced the flag as the guard
  ([ADR-016](ADR-016-multi-ai-pr-review-panel.md) amendments 2026-09-13 and
  2026-09-12). The `--v3` drop recorded here still holds: the v3 engine also
  ignores an agent's `tools: []`.
- [ADR-013](ADR-013-pr-review-gpt56-model-bump.md) records the next GPT model change.
- [ADR-015](ADR-015-pr-review-per-model-parallel-jobs.md) owns the per-model job
  topology and two-Kiro roster structure; [ADR-014](ADR-014-pr-review-opus5-model-bump.md)
  records subsequent Anthropic catalog recovery.

Repository roster changes affect later trusted-base runs. Dockerfile checks affect
rebuilt images only. Reverify CLI flag semantics and model execution on the actual
runner after upgrades; the original probe is not a current availability guarantee.
