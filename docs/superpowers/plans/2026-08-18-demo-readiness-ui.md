# Demo readiness UI — historical implementation record

**Date:** 2026-08-18. **Original branch:** `feat/demo-readiness-ui`.
**Reconciled:** 2026-09-13; UI history below runs through PR #103.
Task-by-task code, commit commands and repeated review transcripts remain in Git
history. This is not a pending execution plan.

## Delivery order and review outcomes

The plan separated test infrastructure, repository links, briefing, bulk start,
scale backend and scale UI into independently reviewable units. The scale ADR
was to precede the frontend consumer. Three cross-model plan rounds and five
repository review rounds refined the same core decisions:

- Add Vitest/jsdom/Testing Library before component/hook tests.
- Return `{ok: boolean}` from toggles so bulk start can batch four requests and
  aggregate actual outcomes instead of inferring success from UI state.
- Keep briefing length restrictions in the display, not the YAML schema.
- Persist scale targets in DynamoDB and forward them through both queue delivery
  and startup recovery. Export `stepKey` from shared and emit it from the API.
- Keep scale separate from lifecycle state transitions, validate resource-specific
  counts at route/controller boundaries and recheck `on` in the worker.
- Patch HPA handles before replicas, fail empty/unknown targets explicitly,
  aggregate results by resource and retain failed-target mutation warnings.
- Update the simulated dev worker explicitly so scale does not fall through into
  turning a project off. Record concurrency, replay and sync limits in ADR-017.

Live-count prefill was removed because it needed a new credential/read path and
could not represent heterogeneous ArgoCD handles with one value. Resource-level
aggregation and eventual status reads were accepted non-production trade-offs,
not complete serialization or rollback mechanisms.

## Implementation history through PR #103

[The design record](../specs/2026-08-18-demo-readiness-ui-design.md) summarizes
intent. The [scale route](../../../dashboard/backend/packages/api/src/routes/scale.ts),
[runner](../../../dashboard/backend/packages/worker/src/job-runner.ts),
[poll loop](../../../dashboard/backend/packages/worker/src/poll-loop.ts),
[frontend hook](../../../dashboard/frontend/hooks/useProjects.ts) and their adjacent
tests implement the contracts.

The old permanently disabled ArgoCD control was superseded by the namespace fix
on 2026-08-20. HPA baselines were added on 2026-08-21, with first-failure limits
clarified on 2026-09-12. PR #103 added confirmation for visible candidates,
client-side 1–20 validation, mounted-control locking, responsive discovery and
request-order protection. Neither locks across clients nor safe crash replay were
added. [ADR-017](../../decisions/ADR-017-demo-scale-job-operation.md) is the current
limitation record; do not reuse the old unconditional range-loss warning.

PR #107 later replaced that bulk-start UI with selected on/off operations,
a sortable operating table and page-level guards.
[Frontend context](../../../dashboard/frontend/CLAUDE.md) owns current dispatch,
retry and page-lifetime behavior. Frontend test code exists but CI omits Vitest.
Image publication remains separate from runtime rollout under the
[release runbook](../../runbooks/review-and-release.md).
