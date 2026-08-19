# Demo Readiness UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator four things ahead of a live demo: a bulk "turn on all" action, a clickable GitHub repo link, a free-text briefing field, and an operator-driven "scale for demo" control (ArgoCD replica count / ECS `desiredCount`) independent of the existing on/off restoration flow.

**Architecture:** Reuses the existing async job model (ADR-001). Three features (bulk turn-on, GitHub link, briefing) are frontend/schema-only. The fourth (scale) adds a new job `operation: 'scale'` with `targets` persisted on the job record, a new route guarded by a plain status read (check-then-act — `scale` has no status transition to attach a DynamoDB `ConditionExpression` to), and new controller-level methods on both `ArgocdController` (dispatching by workload kind) and `EcsController` — structurally separate from the existing turn_on/turn_off postlude so a scale job never mutates project on/off state. Revised across three rounds of cross-model plan review plus one round of this repo's own PR-review gate (2026-08-18); the round-2 review found the "live current-value pre-fill" feature architecturally unimplementable within the `api` package's thin-routes boundary, cut in the following revision. The PR-review gate round fixed a remaining internal contradiction on the status-precondition mechanism, an inaccurate HPA-limitation description, and undefined behavior for the pre-existing zero-matched-workload-handles bug, and added an ADR task (Task 7) — see `docs/superpowers/specs/2026-08-18-demo-readiness-ui-design.md` for the full rationale and the two known, deliberately-unfixed limitations.

**Tech Stack:** Backend — Node20 TS pnpm-workspace (Fastify, vitest, Node16 ESM `.js` imports). Frontend — Next.js 14 App Router, TS, **no test runner configured yet** (Task 0 adds one). Spec: `docs/superpowers/specs/2026-08-18-demo-readiness-ui-design.md`. Branch: `feat/demo-readiness-ui`.

**Deliverable units** → independent PRs, each green on its own: Task 0 (frontend test infra), Task 1 (GitHub link), Task 2 (briefing field), Task 3 (bulk turn-on, depends on Task 0's infra + the `toggle()` refactor inside it), Tasks 4–6 (scale action: backend job op+controllers → backend route → frontend UI), Task 7 (ADR + operator note, can land any time after Task 4 establishes the design's final shape).

---

## File structure

**Backend** (`dashboard/backend/`)
- Modify `packages/shared/src/schemas/project.ts` — add `briefing?: string` (no `.max()`).
- Modify `packages/shared/src/schemas/ddb-records.ts` — widen `JobRecordSchema.operation` enum, add optional `targets` field.
- Modify `packages/shared/src/ddb/jobs.ts` — widen `JobsClient.create`'s operation parameter type to match the schema (accept `targets`); persist `targets` in the `PutCommand` Item, not just the parameter type.
- Create `packages/shared/src/step-key.ts` (or add to an existing shared utility module) — move the `stepKey` computation here from `job-runner.ts` so `api` can import it too.
- Modify `packages/worker/src/job-runner.ts` — import `stepKey` from shared instead of defining it locally; add the `scale` operation branch, kept structurally separate from the turn_on/turn_off postlude (no `markOn`/`markError` calls).
- Modify `packages/worker/src/poll-loop.ts` — widen `MessageBody`/`JobInput` to carry `targets`; carry them through `sweepRunningJobs`' restart-recovery path, reading from the DDB job record.
- Modify `packages/worker/src/controllers/argocd.ts` — add `scale(application, replicas)`: enumerate workload handles via the existing `listWorkloads`, then dispatch per handle using the same inline `kind === 'Deployment' || 'StatefulSet'` vs. HPA checks `turnOn`/`turnOff` already repeat in four places (`patchReplicas(replicas)` for the former, `patchHpaBounds({min: replicas, max: replicas})` for the latter — note `TARGET_KINDS` on the shared client is not the right helper for this, since it includes `HorizontalPodAutoscaler` and can't distinguish replica-bearing from HPA kinds by itself). Zero matched handles (the pre-existing `namespace: 'placeholder'` bug — see Task 4) is an explicit per-target failure, never a vacuous success.
- Modify `packages/worker/src/controllers/ecs.ts` — add `setDesiredCount({cluster, service, count})`.
- Create/extend `packages/worker/src/controllers/__tests__/ecs.test.ts` and `controllers/__tests__/argocd.test.ts` for the new methods.
- Modify `packages/worker/src/__tests__/job-runner.test.ts` — scale-branch coverage, restart-recovery coverage, state-not-mutated assertion, zero-matched-handles-fails coverage.
- Create `packages/api/src/routes/scale.ts` — new `POST /api/projects/:owner/:name/actions/scale` route, reusing the existing `StateClient.read()` (`packages/shared/src/ddb/state.ts` — already does exactly this plain status read, the same way the current `turn_on`/`turn_off` route uses it; no new client method needed) for the precondition, and marking the job `failed` on SQS-enqueue failure.
- Create `packages/api/src/__tests__/scale.test.ts` — route test.
- Modify whichever route currently serves `GET /api/projects/:owner/:name` — add each resource's `stepKey` (from the new shared helper) to the response, so the frontend never computes it itself.
- Modify `packages/api/src/server.ts` — register the new route.
- Modify `packages/api/src/dev-server.ts` — keep the in-memory dev server's shape consistent with the new fields (`briefing`, `stepKey`, `scale` op) so `pnpm dev` doesn't break.

**Frontend** (`dashboard/frontend/`)
- Modify `package.json` — add vitest, `@testing-library/react`, `@testing-library/jest-dom`, jsdom, and a `test` script; add a vitest config with the jsdom environment.
- Modify `components/ProjectCard.tsx` — GitHub link with `stopPropagation`.
- Modify `components/DetailDrawer.tsx` — GitHub link, briefing section, per-resource scale inputs (empty, with a placeholder — no pre-fill).
- Modify `lib/types.ts` — `Project.briefing`, `resource.stepKey`, scale request/response types.
- Modify `lib/api.ts` — `scaleProject`.
- Modify `hooks/useProjects.ts` — revise `toggle()` to resolve `{ok: boolean}` (treating `partial_failure` as `{ok:false}` immediately); add `scale()`; add a `turnOnAll()` bulk helper built on the revised `toggle()`.
- Modify `app/page.tsx` — "Turn on all" button near `StatStrip`.
- Modify `app/globals.css` — styles for the new drawer sections/inputs.

---

## Task 0: Frontend test infrastructure

**Files:**
- Modify: `dashboard/frontend/package.json`
- Create: `dashboard/frontend/vitest.config.ts`
- Create: `dashboard/frontend/vitest.setup.ts` (jest-dom matchers)

- [ ] **Step 1**: Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom` as devDependencies; add a `"test": "vitest run"` script (and `"test:watch": "vitest"`).
- [ ] **Step 2**: Add `vitest.config.ts` with `environment: 'jsdom'`, a setup file registering jest-dom matchers, and path-alias resolution matching `tsconfig.json`'s `@/*` paths (e.g. via `vite-tsconfig-paths` or an explicit `resolve.alias` entry) — without this, any test importing from `@/...` (as `hooks/useProjects.ts` and its future test will) fails to resolve.
- [ ] **Step 3**: Write one trivial smoke test (e.g. rendering `StatStrip` with a fixed prop) to prove the pipeline works end-to-end before any real feature test depends on it.
- [ ] **Step 4**: Commit: `chore(frontend): add vitest + testing-library test infrastructure`.

## Task 1: GitHub repo link (frontend-only)

**Files:**
- Modify: `dashboard/frontend/components/ProjectCard.tsx`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`

- [ ] **Step 1**: In both components, wrap the existing repo-text element in `<a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">`, keeping the same visible text and CSS class. On `ProjectCard`, since the card body's click already opens the detail drawer, give the anchor an `onClick={(e) => e.stopPropagation()}`.
- [ ] **Step 2**: Component test asserting the anchor's `href` for a known `repo` value, and that clicking it does not also trigger the card's open-drawer handler.
- [ ] **Step 3**: Commit: `feat(frontend): clickable GitHub repo link on card and drawer`.

## Task 2: Briefing field (schema + frontend display)

**Files:**
- Modify: `dashboard/backend/packages/shared/src/schemas/project.ts`
- Modify: `dashboard/frontend/lib/types.ts`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1 (TDD, backend)**: Add a schema test asserting `briefing` is optional, accepts a long multi-line string without rejection (no `.max()` at the schema level — a long briefing must not invalidate the project), and that a project YAML without it still parses.
- [ ] **Step 2**: Add `briefing: z.string().optional()` to `ProjectSchema` (no length constraint).
- [ ] **Step 3 (frontend)**: Add `briefing?: string` to the `Project` type in `lib/types.ts`.
- [ ] **Step 4**: Add a "Briefing" section to `DetailDrawer.tsx`, rendered only when `briefing` is truthy, using `white-space: pre-wrap` styling; truncate for display past ~2000 chars with a "show more" toggle (UI-only, not a data constraint). Place it alongside the existing Resources/URL/History sections.
- [ ] **Step 5**: Commit: `feat: add optional project briefing field, shown in the detail drawer`.

## Task 3: Bulk "turn on all" (frontend-only)

**Files:**
- Modify: `dashboard/frontend/hooks/useProjects.ts`
- Modify: `dashboard/frontend/app/page.tsx`

- [ ] **Step 1 (TDD)**: Write a test for the revised `toggle()` in `useProjects.ts`, asserting it resolves `{ok: true}` on `succeeded`, and `{ok: false}` on both `failed` and `partial_failure` (checked as soon as either status is observed, not deferred to the poll timeout).
- [ ] **Step 2**: Refactor `toggle()` to return that result (existing callers that ignore the return value are unaffected).
- [ ] **Step 3 (TDD)**: Write a test for a new `turnOnAll()` helper — given a mixed list of project statuses, it calls `toggle(repo, 'turn_on')` only for `off`/`error` projects, at most 3–5 (pick one fixed value, e.g. 4, and use it consistently — the spec's "3–5" is a range, not a tunable) concurrently, and resolves with `{repo, ok}[]` built from the real per-call results.
- [ ] **Step 4**: Implement `turnOnAll()` using a small concurrency-limited batching helper (no new dependency — a simple chunked loop over the revised `toggle()` is sufficient).
- [ ] **Step 5**: Add a "Turn on all" button in `app/page.tsx` near `StatStrip`; on click, call `turnOnAll()`, then toast a summary from its resolved results.
- [ ] **Step 6**: Commit: `feat(frontend): bulk "turn on all" action for off/error projects`.

## Task 4: Backend — `scale` job operation, controllers, and restart recovery (TDD)

**Files:**
- Test: `dashboard/backend/packages/worker/src/__tests__/job-runner.test.ts`, `controllers/__tests__/ecs.test.ts`, `controllers/__tests__/argocd.test.ts`
- Create: `dashboard/backend/packages/shared/src/step-key.ts`
- Modify: `dashboard/backend/packages/shared/src/schemas/ddb-records.ts`
- Modify: `dashboard/backend/packages/shared/src/ddb/jobs.ts`
- Modify: `dashboard/backend/packages/worker/src/controllers/ecs.ts`
- Modify: `dashboard/backend/packages/worker/src/controllers/argocd.ts`
- Modify: `dashboard/backend/packages/worker/src/job-runner.ts`
- Modify: `dashboard/backend/packages/worker/src/poll-loop.ts`

- [ ] **Step 1**: Move the `stepKey` computation out of `job-runner.ts` into `packages/shared/src/step-key.ts` as a pure, exported function, and re-export it from `packages/shared/src/index.ts` (the package barrel) — a file that isn't part of the barrel isn't importable as `@demo-platform/shared`'s public surface, which is how `api` would consume it. Update `job-runner.ts` to import it from there. No behavior change — this is a pure relocation, covered by the existing restoration tests continuing to pass unmodified.
- [ ] **Step 2**: Widen `JobRecordSchema.operation` (in `ddb-records.ts`) to include `'scale'`, and add an optional `targets` array field on the job record type. Widen `JobsClient.create`'s parameter type in `jobs.ts` to match, and make sure the implementation actually writes `targets` into the `PutCommand` Item (not just the TypeScript parameter type) so DDB persistence and sweep recovery have something to read.
- [ ] **Step 3 (TDD)**: Write a failing `controllers/__tests__/ecs.test.ts` case for a new `setDesiredCount({cluster, service, count})` that calls `UpdateServiceCommand` with the given count and does not touch any restoration-data bookkeeping. Reject (throw) a non-positive or unreasonably large count (e.g. cap at some sane ceiling like 20) before calling AWS at all — same validation belongs on the ArgoCD side for `replicas`. Implement it.
- [ ] **Step 4 (TDD)**: Write failing `controllers/__tests__/argocd.test.ts` cases for a new `scale(application, replicas)` method covering (a) an application whose `listWorkloads` returns only replica-bearing handles (**both** `Deployment` and `StatefulSet` kinds, matching the existing inline `kind === 'Deployment' || 'StatefulSet'` checks already repeated in `turnOn`/`turnOff` — `TARGET_KINDS` on the shared client is not usable for this distinction, since it also includes `HorizontalPodAutoscaler`) — `patchReplicas(replicas)` called per handle, `patchHpaBounds` never called; (b) only HPA-kind handles — `patchHpaBounds({min: replicas, max: replicas})` called (pinning min=max to the requested count, same semantic the design's "Known limitations" section describes), `patchReplicas` never called; (c) a mixed set of kinds — each handle gets the call matching its own kind; (d) `listWorkloads` returns zero handles — the method throws/rejects rather than resolving successfully having done nothing (this is the pre-existing `namespace: 'placeholder'` bug's actual failure mode — see the spec's Architecture section — and `scale` is the first feature where silently doing nothing would look like success to the operator). Implement it by branching on the same inline kind checks `turnOn`/`turnOff` already use, and rejecting the empty-handles case explicitly.
- [ ] **Step 5 (TDD)**: Write failing `job-runner.test.ts` cases for a `scale` operation: (a) an `argocd-app` target calls the new controller's `scale()`; (b) an `ecs` target calls `setDesiredCount`; (c) one target failing while another succeeds yields job status `partial_failure`, both applied targets still take effect; (d) all targets failing yields `failed`; (e) in every case above, the project's `state.status` is asserted unchanged — no `markOn`/`markError` call happens for a `scale` job; (f) a job with an empty or missing `targets` array (possible via restart recovery of a malformed/legacy record) fails explicitly rather than resolving `succeeded` with no work done. Implement the `scale` branch in `job-runner.ts` as a path structurally separate from the existing turn_on/turn_off postlude. Decide and state explicitly whether a `scale` job appends a `HistoryClient` record the way `turn_on`/`turn_off` do (recommended: yes, for audit parity) and implement accordingly.
- [ ] **Step 6 (TDD)**: Write a failing `poll-loop.ts` test asserting (a) a fresh `scale` enqueue's `MessageBody`/`JobInput` carries `targets`; (b) `sweepRunningJobs`' restart recovery reconstructs a `scale` job's `targets` from the DDB job record when re-deriving work after a restart. Implement the plumbing — widen the `MessageBody`/`JobInput` type unions themselves, not just the handler logic around them.
- [ ] **Step 7**: Commit: `feat(worker): add scale job operation with DDB-persisted targets and restart recovery`.

## Task 5: Backend — `scale` route + `stepKey` exposure (TDD)

**Files:**
- Test: `dashboard/backend/packages/api/src/__tests__/scale.test.ts`
- Create: `dashboard/backend/packages/api/src/routes/scale.ts`
- Modify: `dashboard/backend/packages/api/src/server.ts`
- Modify: whichever route file implements `GET /api/projects/:owner/:name`

- [ ] **Step 1 (TDD)**: Write failing tests for `POST /api/projects/:owner/:name/actions/scale`: 409 when `StateClient.read()` (`packages/shared/src/ddb/state.ts` — the existing method already used by the current actions route for the same kind of plain status check; no new client method needed here) finds the project isn't `on`; 400 when `targets` is empty or has duplicate `stepKey`s; 400 when a target `stepKey` doesn't match any resource on the project; 400 when the matched resource's `type` isn't `ecs`/`argocd-app` or is `always_on`; 400 when a target is missing its type's required field (`desiredCount` for `ecs`, `replicas` for `argocd-app`) or carries the wrong one, a non-positive-integer value, or exceeds the sane ceiling from Task 4; on success, creates a job record with `targets` persisted, enqueues one SQS message carrying the same `targets`, and returns `202 {job_id}` without changing project status; on a simulated SQS enqueue failure, the already-created job record ends up `failed` rather than orphaned as `pending` (and if *that* update itself fails, the job stays `pending` and unrecovered by `sweepRunningJobs` — acceptable residual gap for a non-production tool, but state it rather than silently accept it). This is a plain status read, not an atomic conditional write (there is no status transition for `scale` to attach a DynamoDB `ConditionExpression` to) — it narrows but doesn't eliminate the `turn_off` race documented in the spec's Known limitations; use `ConsistentRead: true` on the read to at least avoid a stale-replica read adding to that window.
- [ ] **Step 2**: Implement `routes/scale.ts` (as a route distinct from the existing `:op` route, not a third `:op` value) and register it in `server.ts`.
- [ ] **Step 3 (TDD)**: Write a failing test asserting the `GET /api/projects/:owner/:name` response includes each resource's `stepKey` (imported from the new shared helper), computed the same way the worker computes it.
- [ ] **Step 4**: Add that field to the response.
- [ ] **Step 5**: Commit: `feat(api): add POST .../actions/scale route and expose resource stepKey`.

## Task 6: Frontend — scale UI

**Files:**
- Modify: `dashboard/frontend/lib/types.ts`
- Modify: `dashboard/frontend/lib/api.ts`
- Modify: `dashboard/frontend/hooks/useProjects.ts`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1**: Add `resource.stepKey: string` and scale-target types to `lib/types.ts`.
- [ ] **Step 2 (TDD)**: Write a test for a new `scale(repo, targets)` function in `useProjects.ts` — same POST → job_id → 1s-interval poll pattern as `toggle()`, resolving/toasting `succeeded`/`failed`/`partial_failure` distinctly, with a reminder toast on `succeeded`/`partial_failure` matching the spec's corrected Known-limitations wording (for an `argocd-app` target specifically: "this pins the HPA's autoscaling range to a fixed count — its original min/max range cannot be recovered through this tool, even by scaling back down"; for `ecs` targets, the simpler "this becomes the new turn_off restore point" is still accurate since ECS `desiredCount` has no min/max range to lose).
- [ ] **Step 3**: Add `scaleProject` to `lib/api.ts` and implement `scale()` in `useProjects.ts`.
- [ ] **Step 4**: In `DetailDrawer.tsx`, for `argocd-app`/`ecs` resource chips, add an empty number input (placeholder: "check the console for the current count") and an "Apply" button, keyed by the resource's `stepKey` from the API response; disable both the input and the Apply button when project status isn't `on`.
- [ ] **Step 5**: Commit: `feat(frontend): per-resource demo-scale controls in the detail drawer`.

## Task 7: Record the ADR and a short operator note

**Files:**
- Create: `docs/decisions/ADR-NNN-demo-scale-job-operation.md` (NNN = next number after the highest existing `docs/decisions/ADR-*.md`)
- Modify: `docs/onboarding.md` or the nearest existing operator-facing doc (whichever this repo's convention points to for "how to use the dashboard")

- [ ] **Step 1**: Write the ADR: context (operators need to bump ArgoCD/HPA replica count or ECS `desiredCount` ahead of a demo, independent of on/off), decision (a new `scale` job operation that deliberately skips the state-transition invariant `turn_on`/`turn_off` use, with `targets` persisted on the job record, exposed via a route outside the existing `:op` pattern), and consequences — explicitly including both accepted limitations from the spec's Known-limitations section (HPA range collapse, and the plain-read `turn_off` race) so they're recorded as a conscious trade-off, not just prose in a dated spec that will drift out of view.
- [ ] **Step 2**: Add a short operator-facing paragraph covering the new `briefing:` project-YAML key, the "turn on all" button, and the scale feature's two limitations in plain operator language (not the ADR's implementation framing).
- [ ] **Step 3**: Commit: `docs(adr): record the demo-scale job operation and its accepted limitations`.
