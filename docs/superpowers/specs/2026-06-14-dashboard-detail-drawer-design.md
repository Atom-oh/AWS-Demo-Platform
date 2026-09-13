# Dashboard detail drawer — historical design

**Date:** 2026-06-14. **Original status:** proposed after panel review, pending approval.
**Reconciled:** 2026-09-13. The drawer and history route are implemented; several
UI details evolved. Full draft and review transcript remain in Git history.

## Intent and boundaries

Add resources, demo/code-server links and recent action history beside the project
grid without new live AWS describe calls or cross-account credentials in the API.
Reuse `HistoryClient.list` through a thin authenticated route and keep drawer
selection local to the page. Secrets/discovery management, dynamic `ec2-tag` URLs,
live resource capacity and deep-linking were excluded.

The history route returns `{items}` containing action, actor, account, result,
optional details and `ts` derived from the stored sort key, without DynamoDB keys
or TTL. `limit` defaults to 20 for invalid/nonpositive parsed values and caps at
100; `parseInt` accepts numeric prefixes rather than strictly validating the
whole query string. Unknown projects return 404. The API task receives
`DDB_TABLE_HISTORY`; the existing task-role policy supplies table access.

## Current applicability

The [history route](../../../dashboard/backend/packages/api/src/routes/history.ts),
[route tests](../../../dashboard/backend/packages/api/src/__tests__/history.test.ts)
and [drawer](../../../dashboard/frontend/components/DetailDrawer.tsx) implement
that boundary. The drawer handles missing project details and history errors,
traps/restores focus and refreshes history after its own lifecycle action.

PR #103 replaced whole-card button semantics with native detail buttons and
added responsive layout, scroll locking, modal notifications and scale feedback.
Filtering a project out does not close its drawer while it remains in loaded
rows. The planned expandable history details/errors are not rendered; the timeline
shows action/result/actor/time. The local simulated dev API has no history route,
so its error state cannot validate real history retrieval.

The original backend-before-frontend rollout rationale still applies: verify the
producer endpoint before deploying a consumer. Current UI behavior and checks
belong to the [frontend guide](../../../dashboard/frontend/CLAUDE.md);
[ADR-001](../../decisions/ADR-001-sqs-worker-for-async-jobs.md) explains why worker
history is best-effort and uses actor `system`. Use the
[release runbook](../../runbooks/review-and-release.md), not old revision-selection
commands, for deployment.
