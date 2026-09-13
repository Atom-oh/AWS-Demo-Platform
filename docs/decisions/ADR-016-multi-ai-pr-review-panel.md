# ADR-016: Multi-AI panel, Claude chair and runner-image ownership

> Renumbered from ADR-007 after a collision with the observability NLB decision.

## Status

Accepted (2026-06-14). **Still applicable** to panel/chair architecture and ownership
of the review runner image. Only specific parts are superseded: ADR-011 changes
Kiro CLI routing, ADR-013/014 change models, and ADR-015 changes execution topology
and roster structure. Use [current PR review](../pr-review.md) for active values.
A runner compatibility exception therefore belongs here even though the original
single-job diagram and model roster are historical.

## Context and decision

Replace a single model's review with independent findings and one chair synthesis.
The chair reconciles source evidence rather than mechanically voting or posting
multiple competing verdicts. Panelists emit findings; the chair emits the final
`VERDICT: PASS|FAIL`. Scripts in this repository own orchestration.

This repository also owns `docker/actions-runner-claude/` and
`.github/workflows/runner-image.yml`. Bedrock clients use runner AWS identity;
Kiro uses the existing Secrets Manager `/demo-platform/actions/AI-key` value,
synchronized by ESO. No credential value belongs in documentation or source.
The original Opus/GPT/Kimi/GLM roster and single-job topology have been replaced.

Independent verdicts with a mechanical combined gate were rejected because they
lose contextual adjudication. Publishing every raw review would create noise.
The chosen chair is a failure point and may share biases with panelists; model
agreement is evidence to investigate, not proof. Timeouts bound attempts but do
not guarantee successful execution. Current degraded-coverage behavior is in
ADR-015 and the workflow map; the original all-skip-to-solo behavior is obsolete.

## Update (2026-06-23): runner image ownership and Kiro routing

The image switched from a self-referential base to the official ARC base, added
plugins and a weekly rebuild. CLI pins were later removed for shared weekly builds.
The then-adopted Kiro `--v3` route was later removed by ADR-011. Agy was removed
from headless CI because the available auth path required interactive OAuth.
Local co-agent context support for Agy does not imply an Agy CI panel slot.
The `claude-runner` service account was added to hub runner identity configuration.

## Update (2026-06-23b): Claude self-review

Add an independent Claude panel voice with read-only context tools and no authority
to post a verdict/comment. It uses a job-scoped GitHub token. This creates a separate
review attempt, not a guarantee of model-family independence from the chair.

## Update (2026-08-31): bounded tools and input/output handling

Remove GitHub MCP tools after authentication hangs; retain `Read`/`Grep`/`Glob`
and bounded read-only `gh` commands. Remove the unused standing GitHub PAT from
workflow job configuration. The chair receives diff/panel bodies over stdin to
avoid the single-argument size limit, with unpredictable boundary markers and
explicit treatment of marker-like diff text as untrusted data.

Public output processing is **strip controls → scrub secrets → truncate**. The
UTF-8-aware stripper preserves valid text while removing C0/C1/escape controls;
truncating first could remove a credential prefix or private-key header before
redaction. The scrubber is not a complete exfiltration boundary. See `lib.sh` and
its tests for exact coverage and limitations rather than copying its algorithm.

Invalid primary and fallback generation stays fail-closed and sets
`chair-failed.flag`, distinct from a verified code-finding failure. Each run clears
stale flags. This does not implement every control in the gate-hardening proposal.

## Update (2026-09-12): ai-trader-web compatibility exception

The dedicated `ai-trader-web-claude-arm` fleet selects a retained tag plus immutable
digest while that consumer requires Claude CLI `2.1.240`. `IfNotPresent` is explicit;
Claude native self-update is disabled for that fleet. Other fleets/shared weekly
builds retain their configured behavior. Platform CI and ai-trader-web maintainers
own coordinated contract/image upgrades, retention checks and the removal trigger.
See the [dated compatibility runbook](../runbooks/ai-trader-review-runner.md).
This operational pin does not replace the panel architecture or require every
runner to use the same image revision.

## Update (2026-09-13): shared reviewer context

Explicitly supply the generated `AGENTS.md` from the event's trusted base SHA to
all lenses and the chair. Kiro's isolated cwd and no-tool mode prevent the local
steering bridge from loading that file. Bound context to 12 KiB, fail preparation
if it is missing/oversized, and preserve PR-head instructions as untrusted diff.
The repository harness checks the tracked digest against that stricter budget.
Preparation also size-checks candidate digest bytes as untrusted data, then
discards them; an oversized edit fails its own PR instead of breaking later runs.
This reconciles project conventions without expanding tool permissions or relaxing
severity/coverage gates. Regression tests exercise delivery through isolated Kiro;
model judgment and complete-diff review remain separate evidence.
