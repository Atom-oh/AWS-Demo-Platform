# ADR-010: Bedrock account retention decision for Fable 5 / Mythos 5

## Status

Accepted (2026-07-07). Records the account-level retention decision and its July
validation; it does not establish today's account setting or model catalog.

## Historical context

July testing reported retention-mode errors for the then-selected Fable 5 / Mythos 5
models unless `provider_data_share` was allowed. The account setting was reported
changed on 2026-07-05T12:51:43Z; `bedrock-runtime converse` and `claude -p` then
succeeded against `us.anthropic.claude-fable-5`. Tests through `bedrock-mantle`
continued to reject the attempted modes in that environment.

A later model revert relied on logs from before the reported correction. The
lesson is to match diagnostics to the exact account, endpoint, model and failure
time, rather than treating an old error as current account state. These tests do
not prove that every current model or endpoint has the same retention behavior.

## Decision

Retain the reviewed `provider_data_share` account posture for that use case.
It is an account-level data-handling decision, not a per-request workaround or
an automatic permission granted by a model selection.

For a retention error, verify the authorized AWS identity and query the relevant
account/region before diagnosing. The original investigation used:

```bash
aws sts get-caller-identity
aws bedrock get-account-data-retention --region us-east-1
```

Read the current result alongside the actual request endpoint/model, current
service requirements and timestamped logs. Even a matching setting does not rule
out model-specific incompatibility, propagation or a different account/endpoint.
Do not change retention or revert a model based only on this ADR.

## Consequences

The accepted posture permitted provider data sharing under the terms applicable
to that account at the time; its scope exceeds one CI workflow. Account-wide
retention changes require current authorization covering the intended data-handling
scope and verification afterward. This ADR supplies no instruction to mutate the
account during routine review or troubleshooting.

The historical mantle/runtime difference is diagnostic evidence, not a permanent
capability claim. Use current [review configuration](../../.github/workflows/pr-review.yml)
and [release checks](../runbooks/review-and-release.md) when assessing a model change.
