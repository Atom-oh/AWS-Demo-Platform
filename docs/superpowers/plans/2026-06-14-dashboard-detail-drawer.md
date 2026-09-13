# Dashboard detail drawer — historical implementation record

**Date:** 2026-06-14. **Original form:** eight-task implementation plan on
`feat/dashboard-detail-drawer`. **Reconciled:** 2026-09-13; core work exists in
source. This is no longer an executable checklist. Draft code and commands remain
in Git history; the [design](../specs/2026-06-14-dashboard-detail-drawer-design.md)
retains intent and exclusions.

## Delivery rationale

Split into two reviewable units: first expose existing DynamoDB history through
a thin API route and inject `DDB_TABLE_HISTORY`, then deploy its frontend consumer.
The existing task role already permitted history reads; no new live resource
inspection or cross-account API wiring was required.

The planned backend tasks covered mapped history records, limit handling,
unknown-project tests, server construction and task environment. Frontend tasks
covered matching wire types/client, a null-safe drawer, selection/focus handling,
links, history refresh after toggles, styling and browser smoke checks.

## Implemented evidence and changes

- [History route](../../../dashboard/backend/packages/api/src/routes/history.ts)
  and [tests](../../../dashboard/backend/packages/api/src/__tests__/history.test.ts)
  use `ts` derived from the sort key and strip storage keys/TTL. `parseInt` accepts
  numeric prefixes; the old description of strict noninteger rejection was too broad.
- [API bootstrap](../../../dashboard/backend/packages/api/src/server.ts) and
  [ECS definitions](../../../infra/dashboard-ecs/main.tf) wire the history client
  and environment. Task-definition changes require an explicitly selected revision.
- [Drawer](../../../dashboard/frontend/components/DetailDrawer.tsx) and
  [card](../../../dashboard/frontend/components/ProjectCard.tsx) now use PR #103's
  native detail button and improved focus/notification behavior. The old embedded
  component and fixed-width CSS are superseded.
- The planned expandable history details did not land. The local dev-server has
  no history client/route; its error display tests layout, not real history access.
  Frontend Vitest now exists, although frontend CI still does not run it.

Use [frontend context](../../../dashboard/frontend/CLAUDE.md) for current checks
and [release guidance](../../runbooks/review-and-release.md) for producer readiness,
image publication, explicit rollout and authenticated browser verification.
The plan's expected test output and sample deploy commands were targets, not
recorded successful execution.
