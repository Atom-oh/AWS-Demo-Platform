# Demo Readiness UI — Design

## Context

The dashboard already lets an operator turn a single project on/off, restoring it to
whatever capacity it had before the last `turn_off`. Ahead of a live demo, an operator
currently has to: open each project separately to turn it on, has no clickable GitHub
repo link (only inert `owner/name` text), has no place to read demo talking points
before presenting, and has no way to size a resource up beyond its restored baseline
(e.g. bump ECS `desiredCount` or an ArgoCD-managed HPA's replica count for extra
headroom during the demo).

This spec covers four independent, small additions bundled into one pass since they
touch the same dashboard surface:

1. A "turn on all" bulk action across every off/error project.
2. A clickable GitHub repo link on the project card and detail drawer.
3. A free-text "briefing" field per project, shown in the detail drawer.
4. An operator-driven "scale for demo" action — manually set ArgoCD/HPA replica count
   or ECS `desiredCount` per resource, independent of the existing on/off restoration
   flow.

## Architecture

Reuses the existing async job model (ADR-001: API validates → DDB job record → SQS →
worker) rather than introducing a new execution path. Three of the four features are
pure frontend/schema additions with no new backend logic:

- **Turn on all**: no new endpoint. The frontend enumerates off/error projects and
  calls the existing per-project `turn_on` action with limited concurrency (3–5 at a
  time) to avoid an unbounded SQS enqueue burst.
- **GitHub link**: pure rendering change — `github.repo` (already `owner/name`) wrapped
  in an anchor to `https://github.com/${repo}`. No schema or backend change.
- **Briefing**: a new optional `briefing` string field on the project schema, read-only
  display in the detail drawer.

The fourth, **scale for demo**, needs a new job type since it's a distinct operation
from turn_on/turn_off (it doesn't touch `restoration_data` and requires the project
already be `on`):

- New job `operation: 'scale'`.
- New route `POST /api/projects/:owner/:name/actions/scale` (separate from the existing
  `:op` route, since its request body shape differs) validates the project is
  currently `on`, that every target `stepKey` maps to a real, non-`always_on` resource,
  and that the requested values are positive integers, then creates a job and enqueues
  it — no status transition (project stays `on`).
- `job-runner.ts` gets a `scale` branch that, per target, dispatches by resource type:
  `argocd-app` reuses the existing `argocdClient.patchHpaBounds`/`patchReplicas`;
  `ecs` calls a new, standalone `ecsController.setDesiredCount({cluster, service,
  count})` (independent of the existing turn_on/off restoration capture — it's a
  simple `UpdateServiceCommand`, no bookkeeping).
- Partial failures are recorded per-target as `partial_failure` rather than rolled
  back — a demo operator scaling three resources still wants the two that succeeded.

## Data model changes

`dashboard/backend/packages/shared/src/schemas/project.ts`:
- Add `briefing?: string` at the top level (sibling to `description`), free-form
  multi-line text, no format constraints beyond a soft length cap (~2000 chars,
  enforced at the UI layer, not the schema).

`dashboard/backend/packages/shared/src/schemas/job.ts` (or wherever
`JobRecordSchema.operation` lives):
- Extend the `operation` enum: `'turn_off' | 'turn_on' | 'add_secret' | 'scale'`.

New (not persisted to DDB, SQS message body only):
```
{ jobId, repo, operation: 'scale', targets: [{ stepKey, replicas?, desiredCount? }] }
```
`stepKey` reuses the same resource-identifier convention already used by
`turn_on`/`turn_off` restoration lookups (e.g. `argocd-app:<application>`), so the
frontend doesn't need to invent a new identifier scheme.

Preconditions enforced in `actions.ts`, not the schema: `scale` requires project
status `on`; a target resource with `always_on: true` is rejected with 400.

## Frontend components

- `app/page.tsx`: a "Turn on all" button near `StatStrip`. Computes the off/error
  project list, calls the existing `useProjects.toggle()` per project with a
  concurrency limiter, and surfaces per-project failures via toast (successes are
  silent beyond the existing status change).
- `ProjectCard.tsx` / `DetailDrawer.tsx`: wrap the repo text in
  `<a href="https://github.com/${repo}" target="_blank">`.
- `DetailDrawer.tsx`: new "Briefing" section (whitespace-preserving), rendered only
  when `briefing` is present; sits alongside the existing Resources/URL/History
  sections.
- `DetailDrawer.tsx`: resource chips for `argocd-app`/`ecs` types gain a number input
  (current value pre-filled) plus an "Apply" button, enabled only when project status
  is `on`. `useProjects.ts` gets a new `scale(repo, targets)` function that follows the
  exact same POST → job_id → 1s-interval poll pattern `toggle()` already uses.

## Error handling

- `scale` against an `always_on` resource or a `stepKey` not found on the project:
  400 at the route level, never reaches the queue.
- `scale` requested while project status isn't `on`: 409, same style as the existing
  `turn_off`/`turn_on` status-precondition checks.
- Per-target AWS/K8s call failures inside the worker: recorded per-target, job ends
  `partial_failure` if any target failed while others succeeded, `failed` only if all
  targets failed.
- "Turn on all": an individual project's `turn_on` failing doesn't block the others;
  failures are collected and reported together once the batch finishes.
- Briefing text: no validation beyond a soft UI-side length cap; never fails a save.

## Testing

- Backend: `job-runner.test.ts` (scale branch, argocd + ecs, success and partial
  failure), `ecs.test.ts` (new `setDesiredCount`), `actions.test.ts` (new route's
  validation: unknown `stepKey`, `always_on` rejection, non-`on` status rejection).
- Frontend: `useProjects.test.ts` (`scale()` polling behavior; turn-on-all concurrency
  limiting and partial-failure toast aggregation).
- Existing LocalStack integration harness (DynamoDB/SQS/ECS mocks) is reused as-is;
  no new integration infra needed.
