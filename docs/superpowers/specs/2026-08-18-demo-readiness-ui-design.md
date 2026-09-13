# Demo readiness UI — historical design

**Date:** 2026-08-18. **Original status:** design revised through cross-model review.
**Reconciled:** 2026-09-13. The feature set is implemented and has evolved;
full review rounds and draft contracts remain in Git history.

## Intent and choices

Prepare demos through four additions: bulk start, GitHub repository links,
optional project briefing and per-resource scale. Links/briefing/bulk start reuse
existing metadata and lifecycle endpoints. Scale becomes a separate asynchronous
job, preserving the API/worker boundary and leaving project on/off status unchanged.

The design deliberately removed live count prefill. The API had no resource
controller/assume-role wiring, and an ArgoCD Application can contain workloads
with different counts. An empty input plus console guidance avoided a second
credential path and an ambiguous application-wide "current count".

Other decisions retained in implementation:

- Bulk start calls the existing action in batches of four and collects each
  toggle's `{ok: boolean}` result, including timeout and partial failure.
- Briefing is optional plain text without a schema length cap; a 2,000-character
  preview affects display only, so long briefing text does not invalidate a project.
- Scale targets persist on the job and pass through SQS/recovery. `stepKey` moved
  into shared code and is emitted by the API rather than recomputed in the browser.
- Route/controller validation restricts ECS desired count and ArgoCD replicas to
  integers 1–20. The worker rechecks `on`, patches HPAs before workload replicas,
  aggregates by resource target, and appends history.
- Frontend test infrastructure was added because none existed when planning began.

## Evolution since this design

The namespace-placeholder failure was fixed on 2026-08-20, so ArgoCD scale controls
are no longer permanently disabled. Write-once HPA baselines followed on
2026-08-21; the original claim that every scale irreversibly loses its range is
superseded. Persistence still follows successful controller completion: a first
partial failure can pin an HPA without saving its original bounds. Inspect a failed
first scale before another scale/off captures reduced bounds.

PR #103 narrowed bulk start to confirmed **visible** off/error projects and added
success/failure feedback, native detail buttons, responsive facets, request-order
protection and mounted-control validation/locking. There is no project sort
control. The old assumptions of whole-card click handling, no client validation,
no frontend tests and unconditional ArgoCD disablement are obsolete.

[ADR-017](../../decisions/ADR-017-demo-scale-job-operation.md) owns baseline,
concurrent scale/off, replay and ArgoCD sync limits. The
[frontend guide](../../../dashboard/frontend/CLAUDE.md) owns current UX, manually
mirrored limits and polling; [scale route](../../../dashboard/backend/packages/api/src/routes/scale.ts),
[runner](../../../dashboard/backend/packages/worker/src/job-runner.ts) and
[tests](../../../dashboard/frontend/hooks/__tests__/useProjects.test.ts) provide
source evidence. Implementation does not establish which image is running.
