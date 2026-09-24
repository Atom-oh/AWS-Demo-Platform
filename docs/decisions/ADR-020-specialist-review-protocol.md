# ADR-020: Specialist responsibilities and conditional review synthesis

## Status

Accepted 2026-09-13. Supersedes ADR-015's four-lenses-per-model rule and dropout
floor, and ADR-016's unconditional chair call. Their trusted-context, job isolation,
artifact and runner ownership decisions remain applicable.

## Context

Recent passing PR reviews repeated the same change across sixteen cells. Observed
job timings included tool work, retries and failures; they did not establish a
model accuracy ranking. Useful findings varied by concern, and missing context
also produced false positives. The user approved distinct responsibilities while
retaining independent review of sensitive changes.

## Decision

Use Codex for implementation, Kiro Opus for AWS constraints, Kiro Sol for
operations/recovery, and Claude for auth/data/API/ADR requirements. Trusted routing
selects applicable Kiro roles. Codex and Claude cover all reviewable source paths, maintaining
OpenAI/Anthropic independence without assuming that four slots mean four vendors.
Kiro's AWS value comes from the supplied evidence and assigned scope; this is not
a claim of privileged training data or a reason to grant tools to untrusted PR data.

Validate role, head, reviewed paths, request fingerprints and process status.
Required missing/invalid/truncated output blocks. Kiro startup and provider
failures remain visible. Only complete uncontroversial reports receive a
host-generated summary; substantive candidates and uncertainty require a chair.
The chair cannot waive missing coverage. Preserve existing account limits.

## Consequences

The fully active ordinary path uses four review requests and two Kiro safety
checks; adjudication adds one chair request before retries/fallback. Timing
artifacts permit later comparison; no wall-clock reduction is claimed yet.
The common input bound remains explicit and fail-closed. Larger changes must be split into separately reviewable PRs; a new chunk
coordinator requires its own reviewed implementation.

See [specialist review](../pr-review-specialists.md) for current limits, model
aliases, artifact validation and verification commands. Legacy entrypoints are
retained for regression fixtures and are not the workflow's selected protocol.

The active protocol retains the existing Sol slot; Terra is historical (ADR-013).
Application inference model configuration remains unchanged.

A scope containing only files excluded by the existing, base-approved project
input policy may complete as NOT_APPLICABLE with a PASS gate result. The trusted
collector must account for every path and record the policy hash; the report
identifies excluded paths and claims no model review. Any reviewable source,
unknown exclusion, source omission or failed collector remains blocking. New
exclusions require their own reviewed policy change.

## Amendment (2026-09-24): single-owner path partition, chair always finalizes

Observed panel cost and latency remained high because Codex and Claude reviewed
every path unconditionally, both Kiro roles ran on nearly every PR (frontend-only
diffs were the sole opt-out), and a host-generated summary still repeated four
lenses' worth of description text per role. This amendment supersedes this ADR's
"Codex and Claude cover all reviewable source paths" decision and its
uncontroversial-report/chair-adjudication split; the routing validation,
custody-digest and coverage-failure decisions above remain unchanged.

Deterministic, first-match-wins path ownership (`OWNERSHIP` in `role_review.py`)
assigns every changed path to exactly one specialist by path, never by diff
content: `infra/**` and Terraform files to `kiro-fable`; `k8s/**`,
`argocd-apps/**`, `.github/workflows/**`, `Dockerfile*`, `projects/**` and
`docs/runbooks/**` to `kiro-sol`; API auth/routes, shared schemas, `docs/**` and
`*.md` to `claude-self`; everything else defaults to `codex`. `prepare` splits
the raw diff into one chunk set per role, so each specialist's request carries
only its owned hunks. A role with no owned paths is NOT_APPLICABLE — no CLI
call, no Kiro startup check. This is a deliberate trade-off: a path is reviewed
by its one owning specialist, not independently by every family, in exchange
for materially fewer calls, smaller per-call token cost and no duplicate
findings across roles.

The chair now always finalizes an active (non-blocked, non-NOT_APPLICABLE)
review, replacing the prior deterministic/review split — a clean run with zero
findings still gets one chair-written consolidated result instead of a
host-generated pass-through, and formatting stays consistent whether or not any
candidate needed adjudication. To keep this affordable, the chair receives no
diff for a clean run, only the affected paths' hunks for a Critical/Major
candidate, and the full owned diff only when a free-text uncertainty could
concern any changed line. `claude-self` moves to Claude Opus 5.5
(`global.anthropic.claude-opus-5-5`) and the chair fallback follows it; the chair
primary stays Fable 5.1. `kiro-fable` moves to Kiro's `claude-fable-5.1`, since the
runner's Kiro catalog has no Opus 5.5 and Kiro uses dotted catalog IDs, not
Bedrock profile IDs.
