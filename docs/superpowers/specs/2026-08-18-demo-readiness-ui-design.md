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
from turn_on/turn_off (it doesn't touch `restoration_data` in the normal on/off sense
and requires the project already be `on`). Cross-model review of the first two drafts
of this plan (2026-08-18, rounds 1–2) found several mismatches with the actual
codebase, addressed below: the controller layer job-runner actually holds, the
package boundary between `api` and `worker`, the job/lifecycle state machine, and a
data-loss interaction with the existing `turn_off` restoration snapshot.

**Cut from this design (round 3): live "current value" pre-fill.** The first two
drafts had the scale input pre-filled from a live-read of the resource's current
`desiredCount`/replica count. Round 2 review found this unimplementable as scoped:
the `api` package has no cross-account AWS/ArgoCD client or assume-role wiring at all
(only `worker` does — `packages/api` is meant to stay thin, per its own
`AGENTS.md`/`CLAUDE.md` layering), so adding it would mean duplicating IAM/ArgoCD
credential wiring into a second ECS task, not "reusing existing calls" as originally
claimed. Separately, a single ArgoCD application can back multiple workloads/HPAs
with different replica counts, so "the current value" isn't even well-defined for
that resource type. The scale input is simpler instead: an empty number field with a
placeholder hint ("check the ArgoCD/ECS console for the current count"), which needs
no new backend read path at all. If live pre-fill is wanted later, it belongs in
`worker` (which already has the credentials) exposed through a job or a cache the API
can read, not a synchronous API-layer AWS call — worth its own spec if it comes up.

- New job `operation: 'scale'`, with `targets` **persisted on the job record itself**,
  not only carried in the SQS message body. `sweepRunningJobs`' startup recovery
  reconstructs in-flight jobs from DDB (not from the queue), so a `scale` job with
  SQS-only targets would recover with no targets to act on after a worker restart —
  persisting them on the record fixes that, matching how `turn_on`/`turn_off` already
  keep their working state (`restoration_data`) on the record rather than in the queue.
  The existing `MessageBody`/`JobInput` types in `poll-loop.ts` are narrower than the
  job schema already allows — they need widening alongside the schema, not as an
  afterthought, or the plumbing silently drops `targets` on the SQS-enqueue path too.
- New route `POST /api/projects/:owner/:name/actions/scale` (deliberately separate from
  the existing `:op` route rather than a third value for `:op` — its request body shape
  differs and `:op` is typed as a plain enum). Validates: project status is currently
  `on`; `targets` is non-empty with no duplicate `stepKey`s; every `stepKey` maps to a
  real resource on the project; the resource's `type` is `ecs` or `argocd-app` (other
  types, and `always_on: true` resources, are rejected — there's no scale concept for
  them); an `ecs` target carries `desiredCount` and an `argocd-app` target carries
  `replicas`, both positive integers, and not the other field. The status check is a
  **conditional DDB write** (`ConditionExpression: status = :on`), not a plain
  read-then-write — this narrows, though doesn't eliminate, the race against a
  concurrent `turn_off` (see Known limitation below; this is a non-production tool, so
  full serialization via a distributed lock is deliberately not in scope). On success,
  creates a job (with `targets` on the record) and enqueues it — no project-status
  transition, since `scale` doesn't change on/off state. If the SQS enqueue fails
  after the job record is created, the route marks that job `failed` before returning
  an error, mirroring how the existing `turn_on`/`turn_off` route rolls back on the
  same failure.
- `job-runner.ts` gets a `scale` branch that is **structurally separate from the
  existing turn_on/turn_off postlude** — the current code path treats any operation
  that isn't `turn_off` as a `turn_on` for the purposes of calling `markOn`/`markError`
  on the project's state record. `scale` must not go through that: it only ever
  updates the *job's* status (`succeeded`/`partial_failure`/`failed`), never the
  *project's* `state.status`, since scale doesn't change on/off state. Per target, it
  dispatches by resource type: `argocd-app` calls a new
  `ArgocdController.scale(application, replicas)` method that calls `listWorkloads`
  and then, **per workload, dispatches by that workload's kind** exactly as
  `turnOn`/`turnOff` already do — `patchReplicas` on a Deployment-kind handle,
  `patchHpaBounds` on an HPA-kind handle, never both blindly on every handle (an HPA
  handle rejects `patchReplicas`, a Deployment handle isn't meaningfully affected by
  `patchHpaBounds`). `ecs` targets call a new, standalone
  `EcsController.setDesiredCount({cluster, service, count})` (independent of the
  existing turn_on/off restoration capture — it's a simple `UpdateServiceCommand`, no
  bookkeeping). A job is `partial_failure` if some but not all targets fail, and
  `failed` only if every target fails — matching the job status enum's existing
  meaning. (The ArgoCD client's workload-listing filter has a pre-existing, unrelated
  bug — a hardcoded `namespace: 'placeholder'` — that already affects `turnOn`/
  `turnOff` today; `scale` inherits it unchanged, and fixing it is out of scope here.)
- The `stepKey` convention used by `turn_on`/`turn_off` restoration lookups is
  currently a private helper inside `job-runner.ts` (in the `worker` package).
  Exporting it from `worker` doesn't help — `api` and `frontend` are separate
  packages that don't depend on `worker`. This spec moves the pure function into
  `@demo-platform/shared` (which both `api` and `worker` already depend on) so the new
  route can import and validate against it directly. The frontend still can't import
  a Node package function, so it never computes a `stepKey` itself: the API includes
  each resource's `stepKey` as a field in its existing project-detail response, and
  the frontend just echoes that value back on a scale request.
- **Known limitation, not fixed in this pass**: scaling a resource up and then running
  `turn_off` will capture the *scaled* count as the new `restoration_data` baseline —
  the pre-demo baseline is not separately remembered, so a forgotten "scale back down"
  before ending a demo permanently raises what the next `turn_on` restores to. Given
  this is explicitly a non-production tool, the mitigation is operational, not code: a
  toast after a successful scale reminds the operator that the new count becomes the
  restore point on the next `turn_off`. A real fix (a separate, never-mutated baseline
  distinct from the mutable "current" state) is a bigger change than this pass
  budgets for and would be its own follow-up if it becomes a recurring problem.

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
`turn_on`/`turn_off` restoration lookups (e.g. `argocd-app:<application>`), now living
in `@demo-platform/shared` (see Architecture section above) and echoed per-resource in
the existing `GET /api/projects/:owner/:name` response so the frontend has it without
computing it.

Preconditions enforced in the route via a conditional DDB write, not the schema:
`scale` requires project status `on`; a target resource with `always_on: true`, or a
`type` other than `ecs`/`argocd-app`, is rejected with 400 (see Architecture section
for the full validation list).

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
  (empty, with a "check the console for the current count" placeholder — see the
  cut "current value" feature above) plus an "Apply" button, enabled only when
  project status is `on`. `useProjects.ts` gets a new `scale(repo, targets)` function
  that follows the exact same POST → job_id → 1s-interval poll pattern `toggle()`
  already uses, and surfaces `partial_failure` distinctly from `failed` in its toast
  (some resources scaled, some didn't — different message than a full failure), plus
  the "this becomes the new turn_off baseline" reminder on any success/partial_failure.

## Error handling

- `scale` against an `always_on` resource, a `stepKey` not found on the project, a
  resource `type` other than `ecs`/`argocd-app`, an empty/duplicate-keyed `targets`
  list, or a target missing/mismatching its type's required field: 400 at the route
  level, never reaches the queue.
- `scale` requested while project status isn't `on`: 409 from the conditional-write
  check, same style as the existing `turn_off`/`turn_on` status-precondition checks
  (narrows, but per the Known limitation above doesn't fully eliminate, a race against
  a concurrent `turn_off`).
- SQS enqueue failure after the job record is created: the route marks that job
  `failed` before returning an error response, instead of leaving an orphaned
  `pending` job that `sweepRunningJobs` (which only recovers `running` jobs) would
  never pick up.
- Per-target AWS/K8s call failures inside the worker: recorded per-target, job ends
  `partial_failure` if any target failed while others succeeded, `failed` only if all
  targets failed — same convention the job status enum already uses elsewhere. The
  `scale` branch never calls `markOn`/`markError` on the project's state record —
  only the job's own status changes.
- A worker restart mid-`scale` recovers `targets` from the DDB job record (not the
  now-consumed SQS message) via the same `sweepRunningJobs` path `turn_on`/`turn_off`
  already use.
- "Turn on all": an individual project's `turn_on` failing doesn't block the others;
  failures are collected and reported together once the batch finishes, using the
  revised `toggle()` return value rather than inferred side effects. `toggle()`
  treats a resolved `partial_failure` the same as `failed` (`{ok: false}`)
  immediately, rather than only reacting to `succeeded`/`failed` and letting
  `partial_failure` fall through to a timeout.
- Briefing text: no schema validation; a UI-side soft length cap only affects display
  (e.g. truncation with "show more"), never a save/load rejection.

## Testing

- Backend: `job-runner.test.ts` (scale branch, argocd + ecs, success and partial
  failure, restart-recovery with DDB-persisted `targets`, asserting `state.status` is
  never mutated by a scale job), `controllers/__tests__/ecs.test.ts` (new
  `setDesiredCount`), `controllers/__tests__/argocd.test.ts` (new `scale` method
  dispatching by workload kind across multiple handles, including a mixed
  HPA+Deployment application), new `scale.test.ts` (route validation: unknown
  `stepKey`, `always_on` rejection, wrong-type rejection, non-`on` status rejection via
  the conditional write, malformed target shape, enqueue-failure marks the job
  `failed`).
- Frontend (after the new test-infra setup step): `useProjects.test.ts` (`scale()`
  polling behavior including `partial_failure`; revised `toggle()`'s resolved result;
  turn-on-all concurrency limiting and failure aggregation using that result).
- Existing LocalStack integration harness (DynamoDB/SQS/ECS mocks) is reused as-is
  for backend; no new backend integration infra needed.
