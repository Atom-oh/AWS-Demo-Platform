# ADR-010: Bedrock account data retention mode required for Fable 5 / Mythos 5

## Status
Accepted (2026-07-07)

## Context
Claude Fable 5 and Claude Mythos 5 on Amazon Bedrock only support
`allowed_modes=["provider_data_share"]` — invoking either model returns a 400
("data retention mode 'X' is not available for this model") under any other
account-level data retention mode, including the account default. This is an
**account-wide Bedrock control-plane setting**
(`aws bedrock get-account-data-retention` / `put-account-data-retention`), not
a per-request parameter, and not something `bedrock-mantle` exposes separately
— empirical testing found `bedrock-mantle` independently rejects `default`,
`none`, and even `provider_data_share` (set at the account level) with the same
error, with no known CLI/API knob to fix it for that endpoint specifically. Only
`bedrock-runtime` respects the account setting.

The account was set to `provider_data_share` on 2026-07-05T12:51:43Z, confirmed
via direct `aws bedrock-runtime converse` and `claude -p` calls against
`us.anthropic.claude-fable-5`, both succeeding cleanly. A PR-review chair swap
to Fable 5 was reverted shortly after in a *different* session/context that
diagnosed the same 400 error from stale (pre-fix) CI logs without checking
whether the account setting had already been corrected — the revert's
"invoke blocked under the account's default retention mode" premise no longer
held at the time it was made.

## Decision
Keep the account-wide Bedrock data retention mode at `provider_data_share`.
Before ever reverting a model choice because of a "data retention mode ... is
not available for this model" error, run
`aws bedrock get-account-data-retention --region us-east-1` first — if it
already reads `provider_data_share`, the account is not the problem and the
error has a different cause (check CI logs for which endpoint/model actually
failed, and whether the failure predates the account fix).

## Consequences
- + Fable 5 / Mythos 5 remain usable as Bedrock chair/panel models via
    `bedrock-runtime` without per-request workarounds.
- + This account-level dependency is now documented instead of living only in
    one session's working memory — the exact failure mode this ADR exists to
    prevent recurring.
- − `provider_data_share` means Bedrock inference data for this account may be
    shared with model providers per their terms — a standing account-wide
    posture change, not scoped to this one CI workflow.
- − `bedrock-mantle` remains unusable for Fable 5 / Mythos 5 chair calls until
    AWS exposes an equivalent retention control for that endpoint.
