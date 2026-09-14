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
