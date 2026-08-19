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
   flow. (The ArgoCD/HPA half is currently blocked by a pre-existing bug — see Known
   limitations below — so only the ECS half is actually usable until that bug is
   fixed separately.)

## Architecture

Reuses the existing async job model (ADR-001: API validates → DDB job record → SQS →
worker) rather than introducing a new execution path. Three of the four features are
pure frontend/schema additions with no new backend logic:

- **Turn on all**: no new endpoint. The frontend enumerates off/error projects and
  calls the existing per-project `turn_on` action with limited concurrency (4 at a
  time — a fixed value, not a tunable) to avoid an unbounded SQS enqueue burst.
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

**Cut from this design, following the round-2 review: live "current value" pre-fill.** The first two
drafts had the scale input pre-filled from a live-read of the resource's current
`desiredCount`/replica count. Round 2 review found this unimplementable as scoped:
the `api` package has no cross-account AWS/ArgoCD client or assume-role wiring at all
(only `worker` does — `dashboard/CLAUDE.md` states that cross-account operations
belong in the backend, contrasting it with the frontend rather than with `api`
specifically; in this codebase's `api`/`worker` split, `api` is meant to stay thin and
has no assume-role wiring of its own, so that convention lands on `worker` here — this
inference is this spec's, not a direct quote), so adding
it would mean duplicating IAM/ArgoCD
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
  persisting them on the record fixes that. This mirrors the same principle
  `turn_on`/`turn_off` already follow for their own working state, though on a
  different record: their `restoration_data` durably lives on the *project's*
  `state` record (via `StateClient.markOff`), not the job record, since it needs to
  survive past that job's lifetime; `scale`'s `targets` durably live on the *job*
  record instead, since the job is the only thing that needs them and they have no
  reason to outlive it. The existing `MessageBody`/`JobInput` types in `job-runner.ts`
  (the `JobInput` type specifically) and `poll-loop.ts` (the `MessageBody` type) are narrower than the
  job schema already allows — they need widening alongside the schema, not as an
  afterthought, or the plumbing silently drops `targets` on the SQS-enqueue path too.
- New route `POST /api/projects/:owner/:name/actions/scale` (deliberately separate from
  the existing `:op` route rather than a third value for `:op` — its request body shape
  differs and `:op` is typed as a plain enum). It sits behind the same server-wide
  Cognito JWT plugin and CloudFront-only ingress the existing `:op` route already has —
  registering it as a plain Fastify route under the same server, not a standalone one,
  is what keeps it inside that boundary; this needs no new auth wiring. Validates: project status is currently
  `on`; `targets` is non-empty with no duplicate `stepKey`s; every `stepKey` maps to a
  real resource on the project; the resource's `type` is `ecs` or `argocd-app` — other
  types, including every `always_on: true` resource, are rejected by this single
  type check, since there's no scale concept for them; `EcsResource` and
  `ArgocdResource` are the only *scalable* resource types without an `always_on`
  field (`Ec2Resource` also has none, but `ec2` isn't a scalable type either — every
  non-`ecs`/`argocd-app` type is rejected by the same type check regardless of
  whether it carries `always_on`), so no separate `always_on` check is needed or
  testable for the two types that matter here; an `ecs`
  target carries `desiredCount` and an `argocd-app` target carries
  `replicas`, both positive integers, and not the other field. The status check is a
  plain, eventually-consistent read via the existing `StateClient.read()` (`scale`
  has no status transition of its own to attach a DynamoDB `ConditionExpression` to,
  unlike `turn_on`/`turn_off`) — it narrows but does not fully close the race against
  a concurrent `turn_off` between this read and the worker's own start-of-branch
  recheck (see Known limitation below; this is a non-production tool, so a
  distributed lock or a synthetic transitional status just to gain an atomic
  condition is deliberately not in scope). On success,
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
  and then, **per workload, dispatches by that workload's kind** using the same
  kind-check `turnOn`/`turnOff` already use — `patchReplicas(replicas)` on a
  `Deployment`- or `StatefulSet`-kind handle, `patchHpaBounds({min: replicas, max:
  replicas})` on an HPA-kind handle, never both blindly on every handle (an HPA
  handle rejects `patchReplicas`, a Deployment/StatefulSet handle isn't meaningfully
  affected by `patchHpaBounds`). `ecs` targets call a new, standalone
  `EcsController.setDesiredCount({cluster, service, count})` (independent of the
  existing turn_on/off restoration capture — it's a simple `UpdateServiceCommand`, no
  bookkeeping). A job is `partial_failure` if some but not all *targets* fail, and
  `failed` only if every target fails — a new convention for this operation (the
  existing `runJob` never actually sets `failed` for `turn_on`/`turn_off`; it marks
  `partial_failure` for any error, including all-targets-failed, and only the API's
  enqueue-rollback path sets `failed` — see Error handling below). Aggregation is at
  the *target* level, not per-workload-handle: within a single `argocd-app` target
  backed by multiple handles, one handle failing marks that whole target (and
  therefore, if it's the only target, the whole job) as failed even if a sibling
  handle on the same application patched successfully — accepted for this pass rather
  than building handle-level result aggregation. (The ArgoCD client's workload-listing
  filter has a pre-existing, unrelated bug — a hardcoded `namespace: 'placeholder'` —
  that already affects `turnOn`/`turnOff` today, but silently: `listWorkloads` returns
  zero handles, so those two operations just no-op instead of erroring. `scale`
  inherits the same zero-handles result, but per the explicit-failure rule above that
  means **every `argocd-app` scale attempt fails, unconditionally, until that bug is
  fixed** — this spec does not fix the bug itself, only makes the failure visible
  instead of silent, so `argocd-app` scaling should be treated as not-yet-usable in
  practice; `ecs` scaling is unaffected.) Additionally, at the start of the `scale`
  branch, the worker re-reads the project's `state.status` and fails the whole job
  outright — no `appendProgress` call for any target, no AWS/K8s calls made — if it's
  no longer `on`. This is a job-level abort before any target is attempted, not a
  per-target failure: the resulting job status is `failed`, but the job's `progress`
  map has **no entries at all**, which is exactly what Task 6 Step 2's toast logic
  treats as "no attempt was made" (an absent progress entry, not a `failed:` one) —
  so this abort path never triggers the irreversibility warning, correctly, since
  nothing could have mutated. This recheck shrinks the check-then-act race described
  in Known limitations below from potentially minutes down to the worker's own
  processing time, without needing a lock or a transitional status.
- The `stepKey` convention used by `turn_on`/`turn_off` restoration lookups is
  currently a private helper inside `job-runner.ts` (in the `worker` package).
  Exporting it from `worker` doesn't help — `api` and `frontend` are separate
  packages that don't depend on `worker`. This spec moves the pure function into
  `@demo-platform/shared` (which both `api` and `worker` already depend on) and
  re-exports it from that package's barrel (`src/index.ts`) — a file added under
  `shared/src/` but left out of the barrel isn't part of `@demo-platform/shared`'s
  actual importable surface — so the new route can import and validate against it
  directly. The frontend still can't import
  a Node package function, so it never computes a `stepKey` itself: the API includes
  each resource's `stepKey` as a field in its existing project-detail response, and
  the frontend just echoes that value back on a scale request.
- **Known limitations, not fixed in this pass** (accepted given this is explicitly a
  non-production tool; this list is not the exhaustive record of every accepted
  limitation for this feature — Task 7's ADR in the implementation plan is. Two
  items below were described inaccurately in earlier drafts before this repo's
  PR-review gate caught it: the "ArgoCD/HPA scaling does not work at all today" item
  (round 2 first surfaced the underlying bug's severity; round 4 corrected the ADR's
  overstated `ignoreDifferences` claim about it) and the HPA-range-collapse timing
  in the item below it (round 1 originally described the loss as happening only via
  a later `turn_off`)):
  - **ArgoCD/HPA scaling does not work at all today.** See the Architecture section's
    note on the pre-existing `namespace: 'placeholder'` bug: `listWorkloads` returns
    zero handles for every real application, and this spec's explicit-failure rule
    for zero-matched-handles turns that into a guaranteed failure for every
    `argocd-app` scale attempt. This spec does not fix that bug — fixing it is out of
    scope here — it only ensures the failure surfaces to the operator instead of
    silently doing nothing. `ecs` scaling is unaffected and works as designed.
  - **For `argocd-app` targets, once the namespace bug above is fixed, scaling
    irreversibly collapses the HPA's autoscaling
    range — at the moment of the scale itself, not only after a later `turn_off`.**
    `scale` pins `patchHpaBounds({min: replicas, max: replicas})`; nothing captures
    the pre-scale `min`/`max` before overwriting them. A demo scale from an autoscaled
    `min=2,max=10` to a fixed `replicas=5` leaves the HPA pinned at `min=max=5`
    immediately — "scaling back down" afterward (e.g. back to `replicas=2`) still goes
    through the same pin-to-a-single-value path, so the original asymmetric range can
    never be recovered through this feature, with or without a subsequent `turn_off`.
    (A later `turn_off` additionally captures whatever the *last* pinned value was as
    the `restoration_data` baseline, so a forgotten "scale back down" also raises what
    the next `turn_on` restores to — a second-order consequence of the same root
    cause, not a separate bug.) Mitigated operationally, not in code: the scale UI's
    success/partial-failure toast states this plainly for `argocd-app` targets
    specifically, rather than the milder "becomes the new restore point" framing an
    earlier draft used. `ecs` targets have no such range to lose — `desiredCount` has
    no min/max concept, so only the `turn_off`-baseline consequence applies there. A
    real fix (capturing pre-scale HPA bounds on the job record as a distinct,
    never-silently-overwritten value, so a later "restore original range" action is
    possible) is a bigger change than this pass budgets for.
  - The `scale` route's status precondition is a plain, eventually-consistent read,
    not an atomic conditional write (`scale` has no status transition of its own to
    attach one to) — a `scale` and a concurrent `turn_off` can still race between
    that route-level read and the worker acting on it. This is narrowed, not
    eliminated, by the worker's own start-of-branch status recheck (see Architecture
    above), which shrinks the window from however long the job sits queued (SQS
    latency, or minutes if a restart/sweep-recovery cycle intervenes) down to the
    worker's own processing time for that job — a cheap recheck, not a fix. A
    complete fix needs either a distributed lock or a synthetic transitional status
    invented solely to get an atomic condition, both bigger than this pass budgets
    for.

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

Preconditions enforced in the route via a plain status read, not the schema:
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
  can't tell what happened, and its poll loop only reacts to `succeeded`/`failed`,
  silently falling through on timeout). Change it to always resolve — never reject —
  `{ok: boolean}`: `true` on `succeeded`, `false` on `failed`, `false` on
  `partial_failure` (checked as soon as observed, not deferred to poll timeout), and
  `false` if the poll loop exhausts its timeout while the job is still running. This
  lets the new bulk helper aggregate real `{repo, ok}` results instead of guessing
  from side effects, and closes off the "still throws sometimes" ambiguity a caller
  doing `Promise.all` over multiple `toggle()` calls would otherwise have to guard
  against.
- `ProjectCard.tsx` / `DetailDrawer.tsx`: wrap the repo text in
  `<a href="https://github.com/${repo}" target="_blank" rel="noreferrer">`. On
  `ProjectCard`, the card body itself is already a click target that opens the detail
  drawer, so the new anchor's click handler must call `stopPropagation()` — otherwise
  clicking the repo link also opens the drawer.
- `DetailDrawer.tsx`: new "Briefing" section (whitespace-preserving), rendered only
  when `briefing` is present; sits alongside the existing Resources/URL/History
  sections.
- `DetailDrawer.tsx`: resource chips gain a number input (empty, with a "check the
  ArgoCD/ECS console for the current count" placeholder — see the cut "current
  value" feature above) plus an "Apply" button. For `ecs` resource chips, both are
  enabled only when project status is `on`. For `argocd-app` resource chips, both
  are **disabled unconditionally** with an inline note that ArgoCD/HPA scaling
  doesn't work yet (see Known limitations — the pre-existing `namespace:
  'placeholder'` bug makes every `argocd-app` scale attempt fail today); this UI
  ships disabled specifically so the not-yet-working path isn't presented as live —
  it re-enables once that bug is fixed separately. `useProjects.ts` gets a new
  `scale(repo, targets)` function that follows the exact same POST → job_id →
  1s-interval poll pattern `toggle()` already uses, and surfaces `partial_failure`
  distinctly from `failed` in its toast (some resources scaled, some didn't —
  different message than a full failure). It scopes its post-scale reminder using
  the job's per-`stepKey` `progress` map (the same field `GET /api/jobs/:id`
  already returns from `runJob`'s existing `appendProgress` calls — no new API
  surface), not the coarser target-level `succeeded`/`partial_failure`/`failed`
  status: for an `ecs` target, the reminder fires only for a `stepKey` whose
  progress entry is `done` ("this becomes the new `turn_off` restore point" — ECS
  `desiredCount` has no min/max range to lose, and `setDesiredCount` is a single
  atomic call with no partial-mutation case). For an `argocd-app` target, the
  reminder fires whenever that `stepKey`'s progress entry is anything other than
  "no attempt was made" — including a `done` **or** a `failed:` entry — because
  Task 4's HPA-first patch ordering means a multi-handle application's HPA can
  already be irreversibly pinned before a sibling Deployment/StatefulSet handle
  fails and the *target* is aggregated as failed; the frontend cannot distinguish
  "nothing happened" from "partially, irreversibly happened" for that case, so it
  warns on any non-idle outcome rather than risk suppressing the warning exactly
  when the mutation occurred (see Architecture's Known limitations above — this is
  accepted limitation #6 there). The frontend doesn't
  know a target's underlying workload kind (Deployment/StatefulSet vs. HPA) within
  an `argocd-app` application, only that it's `argocd-app` vs. `ecs`, so the
  ArgoCD-side wording is phrased conditionally ("if this application contains an
  HPA…") rather than asserting range loss unconditionally. This wording and
  scoping logic in `scale()` is unit-tested directly even though the `argocd-app`
  input is disabled in the UI today — it becomes reachable the moment the
  namespace bug is fixed, and untested-until-then dead code is worse than an
  unreachable but correct implementation.

## Error handling

- `scale` against an `always_on` resource, a `stepKey` not found on the project, a
  resource `type` other than `ecs`/`argocd-app`, an empty/duplicate-keyed `targets`
  list, or a target missing/mismatching its type's required field: 400 at the route
  level, never reaches the queue.
- `scale` requested while project status isn't `on`: 409 from that status read
  check, same style as the existing `turn_off`/`turn_on` status-precondition checks
  (narrows, but per the Known limitation above doesn't fully eliminate, a race against
  a concurrent `turn_off`).
- SQS enqueue failure after the job record is created: the route marks that job
  `failed` before returning an error response, instead of leaving an orphaned
  `pending` job that `sweepRunningJobs` (which only recovers `running` jobs) would
  never pick up.
- Per-target AWS/K8s call failures inside the worker: recorded per-target, job ends
  `partial_failure` if any target failed while others succeeded, `failed` only if all
  targets failed — a convention new to `scale` (see Architecture above for how this
  differs from `turn_on`/`turn_off`'s existing `runJob` behavior). Aggregation is at
  the target level, not per-workload-handle, within a single `argocd-app` target. The
  `scale` branch never calls `markOn`/`markError` on the project's state record —
  only the job's own status changes. If the worker's start-of-branch status recheck
  (Architecture above) finds the project no longer `on`, the job fails outright before
  any target is attempted.
- A worker restart mid-`scale` recovers `targets` from the DDB job record (not the
  now-consumed SQS message) via the same `sweepRunningJobs` path `turn_on`/`turn_off`
  already use.
- `scale` against an `error`-status project is rejected by the same `on`-only
  precondition as any other status — an accepted design choice, not an oversight: an
  `error` project's resources are in an unknown state, so scaling any of them
  individually is out of scope for this pass (the operator's path back to a scalable
  state is the existing `turn_on` retry, which already accepts `error`).
- No in-flight guard prevents two `scale` requests targeting the same resource from
  overlapping; accepted as a known gap for this non-production tool, same spirit as
  the other accepted races in this section.
- "Turn on all": an individual project's `turn_on` failing doesn't block the others;
  failures are collected and reported together once the batch finishes, using the
  revised `toggle()` return value rather than inferred side effects. `toggle()`
  treats a resolved `partial_failure` the same as `failed` (`{ok: false}`)
  immediately, rather than only reacting to `succeeded`/`failed` and letting
  `partial_failure` fall through to a timeout.
- Briefing text: optional, but no length constraint at the schema level; a UI-side soft length cap only affects display
  (e.g. truncation with "show more"), never a save/load rejection.

## Testing

- Backend: `job-runner.test.ts` (scale branch, argocd + ecs, success and partial
  failure, asserting `state.status` is never mutated by a scale job, zero-matched-
  handles and empty-`targets` both fail explicitly), a `poll-loop.ts` test (restart
  recovery reconstructing `targets` from the DDB job record, and a fresh enqueue
  carrying `targets` in `MessageBody`/`JobInput`), `controllers/__tests__/ecs.test.ts`
  (new `setDesiredCount`), `controllers/__tests__/argocd.test.ts` (new `scale` method
  dispatching by workload kind across multiple handles, including a mixed
  HPA+Deployment application, and the zero-handles case), new `scale.test.ts` (route
  validation: unknown `stepKey`, wrong-type rejection (this single case already
  covers `always_on` resources too — see Architecture above for why that's not a
  separately-testable case), non-`on`
  status rejection via the status precondition, malformed target shape, enqueue-failure marks the job
  `failed`).
- Frontend (after the new test-infra setup step): `useProjects.test.ts` (`scale()`
  polling behavior including `partial_failure`; revised `toggle()`'s resolved result;
  turn-on-all concurrency limiting and failure aggregation using that result).
- Existing LocalStack integration harness (DynamoDB/SQS/ECS mocks) is reused as-is
  for backend; no new backend integration infra needed.
