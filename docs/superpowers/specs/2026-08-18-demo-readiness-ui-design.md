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
already be `on`). Cross-model review of the first draft of this plan found that
`patchHpaBounds`/`patchReplicas` live on the internal `ArgocdClient`, not on the
`ArgocdController` that `job-runner.ts` actually holds — and that per-workload handles
come from `listWorkloads(app)`, not from the application name alone. The design below
routes through a new controller-level method instead of assuming direct client access.

It also surfaces a read gap: nothing today exposes a resource's *current* desired
count / replica count, which both the "pre-fill the input" frontend requirement and
the worker's own idempotent-restart story need. This spec adds a small read path for
that (see Data model changes) rather than deferring it, since without it the frontend
requirement in the original draft was not implementable.

- New job `operation: 'scale'`, with `targets` **persisted on the job record itself**,
  not only carried in the SQS message body. `sweepRunningJobs`' startup recovery
  reconstructs in-flight jobs from DDB (not from the queue), so a `scale` job with
  SQS-only targets would recover with no targets to act on after a worker restart —
  persisting them on the record fixes that, matching how `turn_on`/`turn_off` already
  keep their working state (`restoration_data`) on the record rather than in the queue.
- New route `POST /api/projects/:owner/:name/actions/scale` (deliberately separate from
  the existing `:op` route rather than a third value for `:op` — its request body shape
  differs and `:op` is typed as a plain enum). Validates: project status is currently
  `on` (409 otherwise); `targets` is non-empty with no duplicate `stepKey`s; every
  `stepKey` maps to a real resource on the project; the resource's `type` is `ecs` or
  `argocd-app` (other types, and `always_on: true` resources, are rejected — there's no
  scale concept for them); an `ecs` target carries `desiredCount` and an `argocd-app`
  target carries `replicas`, both positive integers, and not the other field. On success,
  creates a job (with `targets` on the record) and enqueues it — no status transition.
- `job-runner.ts` gets a `scale` branch that, per target, dispatches by resource type:
  `argocd-app` calls a new `ArgocdController.scale(application, replicas)` method that
  internally calls `listWorkloads` then `patchHpaBounds`/`patchReplicas` per workload
  handle (mirrors how `turnOn`/`turnOff` already enumerate workloads); `ecs` calls a
  new, standalone `EcsController.setDesiredCount({cluster, service, count})`
  (independent of the existing turn_on/off restoration capture — it's a simple
  `UpdateServiceCommand`, no bookkeeping). A job is `partial_failure` if some but not
  all targets fail, and `failed` only if every target fails — matching the job status
  enum's existing meaning.
- The `stepKey` convention used by `turn_on`/`turn_off` restoration lookups is
  currently a private helper inside `job-runner.ts`. This spec exports it (or an
  equivalent pure function) from a shared location so the new route and the frontend
  can both compute/validate against the same identifier scheme without duplicating it.

## Data model changes

`dashboard/backend/packages/shared/src/schemas/project.ts`:
- Add `briefing?: string` at the top level (sibling to `description`), free-form
  multi-line text. No `.max()` on the Zod schema itself — the field is loaded from
  git-committed YAML at startup (`projects-loader.ts`), and a schema-level cap would
  make an over-length briefing invalidate the *entire* project file, silently dropping
  it from the dashboard rather than just showing a long briefing. The ~2000-char cap
  from the earlier draft is UI-display-only (e.g. a "show more" truncation), never a
  save-time or load-time rejection.

`dashboard/backend/packages/shared/src/schemas/ddb-records.ts` (corrected from the
earlier draft's `schemas/job.ts`, which doesn't exist — this is where
`JobRecordSchema.operation` actually lives):
- Extend the `operation` enum: `'turn_off' | 'turn_on' | 'add_secret' | 'scale'`.
- Add an optional `targets?: { stepKey: string; replicas?: number; desiredCount?: number }[]`
  field to the job record itself (persisted to DDB, not just the SQS message), for the
  restart-recovery reason described above.

`dashboard/backend/packages/shared/src/ddb/jobs.ts`:
- `JobsClient.create`'s parameter type has a hardcoded `operation: 'turn_off' |
  'turn_on'` union independent of the schema enum — this needs to be widened to match
  (ideally derived from the schema type rather than re-declared) so it accepts
  `'scale'` and the new `targets` field; otherwise the route's `create({operation:
  'scale', targets})` call fails to typecheck.

SQS message body mirrors the job record's relevant fields (kept in sync, not a new
shape): `{ jobId, repo, operation: 'scale', targets }`.

`stepKey` reuses the same resource-identifier convention already used by
`turn_on`/`turn_off` restoration lookups (e.g. `argocd-app:<application>`); see the
Architecture section above on exporting it from a shared location.

Preconditions enforced in the route, not the schema: `scale` requires project status
`on`; a target resource with `always_on: true`, or a `type` other than `ecs`/
`argocd-app`, is rejected with 400 (see Architecture section for the full validation
list).

**Exposing current values for pre-fill**: no existing endpoint returns a resource's
live `desiredCount` or replica count — the project detail response only has the
static YAML `resources` list plus `state.status`. Add a best-effort, read-only
`current` field per resource to the existing `GET /api/projects/:owner/:name` response
(populated via `DescribeServicesCommand` for `ecs` targets and `listWorkloads` +
existing HPA read logic for `argocd-app` targets, both already used elsewhere in the
worker/controllers for other purposes). This read is synchronous and best-effort: a
failure to fetch a live value leaves that resource's `current` absent, and the
frontend renders the number input empty (not pre-filled) rather than blocking the
detail view.

## Frontend components

**Test infrastructure gap**: `dashboard/frontend/package.json` currently has no test
runner at all (no vitest/jest, no `@testing-library/*`, no `test` script) — the earlier
draft assumed one existed. This spec adds a minimal setup (vitest + `@testing-library/
react` + jsdom environment, one `test` script) as its own first step, since every other
frontend task in this spec depends on it for TDD.

- `app/page.tsx`: a "Turn on all" button near `StatStrip`. Computes the off/error
  project list, calls a revised `useProjects.toggle()` (see below) per project with a
  concurrency limiter, and surfaces per-project failures via toast (successes are
  silent beyond the existing status change).
- `useProjects.ts`: `toggle()` currently swallows its own success/failure (callers
  can't tell what happened). Change it to resolve `{ok: boolean}` (or throw) so the new
  bulk helper can aggregate real `{repo, ok}` results instead of guessing from side
  effects.
- `ProjectCard.tsx` / `DetailDrawer.tsx`: wrap the repo text in
  `<a href="https://github.com/${repo}" target="_blank" rel="noreferrer">`. On
  `ProjectCard`, the card body itself is already a click target that opens the detail
  drawer, so the new anchor's click handler must call `stopPropagation()` — otherwise
  clicking the repo link also opens the drawer.
- `DetailDrawer.tsx`: new "Briefing" section (whitespace-preserving), rendered only
  when `briefing` is present; sits alongside the existing Resources/URL/History
  sections.
- `DetailDrawer.tsx`: resource chips for `argocd-app`/`ecs` types gain a number input
  plus an "Apply" button, enabled only when project status is `on`. The input is
  pre-filled from the new `current` field on the project response (see Data model
  changes) when present, otherwise left empty with a placeholder. `useProjects.ts`
  gets a new `scale(repo, targets)` function that follows the exact same POST → job_id
  → 1s-interval poll pattern `toggle()` already uses, and surfaces `partial_failure`
  distinctly from `failed` in its toast (some resources scaled, some didn't — different
  message than a full failure).

## Error handling

- `scale` against an `always_on` resource, a `stepKey` not found on the project, a
  resource `type` other than `ecs`/`argocd-app`, an empty/duplicate-keyed `targets`
  list, or a target missing/mismatching its type's required field: 400 at the route
  level, never reaches the queue.
- `scale` requested while project status isn't `on`: 409, same style as the existing
  `turn_off`/`turn_on` status-precondition checks.
- Per-target AWS/K8s call failures inside the worker: recorded per-target, job ends
  `partial_failure` if any target failed while others succeeded, `failed` only if all
  targets failed — same convention the job status enum already uses elsewhere.
- A worker restart mid-`scale` recovers `targets` from the DDB job record (not the
  now-consumed SQS message) via the same `sweepRunningJobs` path `turn_on`/`turn_off`
  already use.
- "Turn on all": an individual project's `turn_on` failing doesn't block the others;
  failures are collected and reported together once the batch finishes, using the
  revised `toggle()` return value rather than inferred side effects.
- Briefing text: no schema validation; a UI-side soft length cap only affects display
  (e.g. truncation with "show more"), never a save/load rejection.
- The best-effort `current` value read (for pre-fill) never blocks or fails the
  project detail response — a failed live-read just means that resource's input
  starts empty.

## Testing

- Backend: `job-runner.test.ts` (scale branch, argocd + ecs, success and partial
  failure, restart-recovery with DDB-persisted `targets`), `controllers/__tests__/
  ecs.test.ts` (new `setDesiredCount`), `controllers/__tests__/argocd.test.ts` (new
  `scale` method against multiple workload handles), `actions.test.ts`/new
  `scale.test.ts` (route validation: unknown `stepKey`, `always_on` rejection,
  wrong-type rejection, non-`on` status rejection, malformed target shape).
- Frontend (after the new test-infra setup step): `useProjects.test.ts` (`scale()`
  polling behavior including `partial_failure`; revised `toggle()`'s resolved result;
  turn-on-all concurrency limiting and failure aggregation using that result).
- Existing LocalStack integration harness (DynamoDB/SQS/ECS mocks) is reused as-is
  for backend; no new backend integration infra needed.
