# ADR-013: Independent GPT model selection for Codex and Kiro

## Status

Accepted (2026-07-15); original model selections subsequently superseded by
[ADR-015](ADR-015-pr-review-per-model-parallel-jobs.md) and the 2026-09-09 amendment
in [ADR-014](ADR-014-pr-review-opus5-model-bump.md). The distinction between access
paths remains applicable. See [current configuration](../pr-review.md).

## Context and decision

The July change replaced Codex's `openai.gpt-5.5` with `openai.gpt-5.6-sol` on its
then-current Bedrock provider, and Kiro's `gpt-5.5` slot with `gpt-5.6-terra` through
Kiro's own catalog. Both had successful local probes recorded at the time.
Different aliases across these catalogs were intentional, not spelling mistakes;
a listing from one API did not establish availability through the other.

Codex's provider/model lived in the runner image's `config.toml`; Kiro's mapping
lived in repository scripts. The former required an image rebuild, while the
latter applied on later trusted-base workflow runs. Preserve that distinction
when diagnosing why configured and running models differ.

## Current applicability

Use `docker/actions-runner-claude/config.toml` for Codex and
`scripts/pr-review/lib.sh` for Kiro. Do not restore the July values from this ADR.
Verify each selected model with its actual client/endpoint. Historical probes,
CLI versions and catalog observations do not prove current availability or pricing.
Shared weekly images follow vendor releases; scoped consumer compatibility pins
are documented in ADR-016 and their runbook.
