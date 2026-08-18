# Demo Readiness UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator four things ahead of a live demo: a bulk "turn on all" action, a clickable GitHub repo link, a free-text briefing field, and an operator-driven "scale for demo" control (ArgoCD replica count / ECS `desiredCount`) independent of the existing on/off restoration flow.

**Architecture:** Reuses the existing async job model (ADR-001). Three features (bulk turn-on, GitHub link, briefing) are frontend/schema-only. The fourth (scale) adds a new job `operation: 'scale'` with `targets` persisted on the job record (not SQS-only — needed for restart recovery), a new route, new controller methods on both `ArgocdController` and `EcsController` (not the raw client), and a new best-effort read path so the UI can show current values before scaling. Revised after a cross-model plan review (2026-08-18) found the first draft's controller wiring, restart-recovery, and frontend-test-infra assumptions didn't match the actual codebase — see `docs/superpowers/specs/2026-08-18-demo-readiness-ui-design.md` for the corrected rationale.

**Tech Stack:** Backend — Node20 TS pnpm-workspace (Fastify, vitest, Node16 ESM `.js` imports). Frontend — Next.js 14 App Router, TS, **no test runner configured yet** (Task 0 adds one). Spec: `docs/superpowers/specs/2026-08-18-demo-readiness-ui-design.md`. Branch: `feat/demo-readiness-ui`.

**Deliverable units** → independent PRs, each green on its own: Task 0 (frontend test infra), Task 1 (GitHub link), Task 2 (briefing field), Task 3 (bulk turn-on, depends on Task 0's infra + the `toggle()` refactor inside it), Tasks 4–7 (scale action: backend job op → backend route → backend current-value read → frontend UI).

---

## File structure

**Backend** (`dashboard/backend/`)
- Modify `packages/shared/src/schemas/project.ts` — add `briefing?: string` (no `.max()`).
- Modify `packages/shared/src/schemas/ddb-records.ts` — widen `JobRecordSchema.operation` enum, add optional `targets` field.
- Modify `packages/shared/src/ddb/jobs.ts` — widen `JobsClient.create`'s operation parameter type to match the schema (accept `targets`).
- Modify `packages/worker/src/job-runner.ts` — export the `stepKey` helper (or an equivalent), add the `scale` operation branch.
- Modify `packages/worker/src/poll-loop.ts` — carry `targets` through `MessageBody`/`JobInput` and the `sweepRunningJobs` restart-recovery path (reading `targets` from the DDB job record, not the queue).
- Modify `packages/worker/src/controllers/argocd.ts` — add `scale(application, replicas)`, enumerating workload handles via the existing `listWorkloads` and calling `patchHpaBounds`/`patchReplicas` per handle.
- Modify `packages/worker/src/controllers/ecs.ts` — add `setDesiredCount({cluster, service, count})`.
- Create `packages/worker/src/controllers/__tests__/ecs.test.ts` additions (or the file, if it doesn't already exist under this path) and `controllers/__tests__/argocd.test.ts` additions for the new methods.
- Modify `packages/worker/src/__tests__/job-runner.test.ts` — scale-branch coverage, restart-recovery coverage.
- Create `packages/api/src/routes/scale.ts` — new `POST /api/projects/:owner/:name/actions/scale` route.
- Create `packages/api/src/__tests__/scale.test.ts` — route test.
- Modify `packages/api/src/routes/projects.ts` (or wherever `GET /api/projects/:owner/:name` is implemented) — add a best-effort `current` value per `ecs`/`argocd-app` resource in the response.
- Modify `packages/api/src/server.ts` — register the new route.
- Modify `packages/api/src/dev-server.ts` — keep the in-memory dev server's shape consistent with the new fields (`briefing`, `current`, `scale` op) so `pnpm dev` doesn't break.

**Frontend** (`dashboard/frontend/`)
- Modify `package.json` — add vitest, `@testing-library/react`, `@testing-library/jest-dom`, jsdom, and a `test` script; add a vitest config with the jsdom environment.
- Modify `components/ProjectCard.tsx` — GitHub link with `stopPropagation`.
- Modify `components/DetailDrawer.tsx` — GitHub link, briefing section, per-resource scale inputs (pre-filled from `current` when present).
- Modify `lib/types.ts` — `Project.briefing`, `resource.current`, scale request/response types.
- Modify `lib/api.ts` — `scaleProject`.
- Modify `hooks/useProjects.ts` — revise `toggle()` to resolve `{ok: boolean}`; add `scale()`; add a `turnOnAll()` bulk helper built on the revised `toggle()`.
- Modify `app/page.tsx` — "Turn on all" button near `StatStrip`.
- Modify `app/globals.css` — styles for the new drawer sections/inputs.

---

## Task 0: Frontend test infrastructure

**Files:**
- Modify: `dashboard/frontend/package.json`
- Create: `dashboard/frontend/vitest.config.ts`
- Create: `dashboard/frontend/vitest.setup.ts` (jest-dom matchers)

- [ ] **Step 1**: Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `jsdom` as devDependencies; add a `"test": "vitest run"` script (and `"test:watch": "vitest"`).
- [ ] **Step 2**: Add `vitest.config.ts` with `environment: 'jsdom'` and a setup file registering jest-dom matchers.
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

- [ ] **Step 1 (TDD)**: Write a test for the revised `toggle()` in `useProjects.ts`, asserting it resolves `{ok: true}` on `succeeded` and `{ok: false}` on `failed`/timeout, rather than only mutating local state.
- [ ] **Step 2**: Refactor `toggle()` to return that result (existing callers that ignore the return value are unaffected).
- [ ] **Step 3 (TDD)**: Write a test for a new `turnOnAll()` helper — given a mixed list of project statuses, it calls `toggle(repo, 'turn_on')` only for `off`/`error` projects, at most N (e.g. 4) concurrently, and resolves with `{repo, ok}[]` built from the real per-call results.
- [ ] **Step 4**: Implement `turnOnAll()` using a small concurrency-limited batching helper (no new dependency — a simple chunked loop over the revised `toggle()` is sufficient).
- [ ] **Step 5**: Add a "Turn on all" button in `app/page.tsx` near `StatStrip`; on click, call `turnOnAll()`, then toast a summary from its resolved results.
- [ ] **Step 6**: Commit: `feat(frontend): bulk "turn on all" action for off/error projects`.

## Task 4: Backend — `scale` job operation, controllers, and restart recovery (TDD)

**Files:**
- Test: `dashboard/backend/packages/worker/src/__tests__/job-runner.test.ts`, `controllers/__tests__/ecs.test.ts`, `controllers/__tests__/argocd.test.ts`
- Modify: `dashboard/backend/packages/shared/src/schemas/ddb-records.ts`
- Modify: `dashboard/backend/packages/shared/src/ddb/jobs.ts`
- Modify: `dashboard/backend/packages/worker/src/controllers/ecs.ts`
- Modify: `dashboard/backend/packages/worker/src/controllers/argocd.ts`
- Modify: `dashboard/backend/packages/worker/src/job-runner.ts`
- Modify: `dashboard/backend/packages/worker/src/poll-loop.ts`

- [ ] **Step 1**: Widen `JobRecordSchema.operation` (in `ddb-records.ts`) to include `'scale'`, and add an optional `targets` array field on the job record type. Widen `JobsClient.create`'s parameter type in `jobs.ts` to match (accept `operation: 'scale'` and `targets`) instead of its current hardcoded `'turn_off'|'turn_on'` union.
- [ ] **Step 2 (TDD)**: Write a failing `controllers/__tests__/ecs.test.ts` case for a new `setDesiredCount({cluster, service, count})` that calls `UpdateServiceCommand` with the given count and does not touch any restoration-data bookkeeping. Implement it.
- [ ] **Step 3 (TDD)**: Write a failing `controllers/__tests__/argocd.test.ts` case for a new `scale(application, replicas)` method: it calls `listWorkloads(application)`, then `patchHpaBounds({min:replicas,max:replicas})` + `patchReplicas(replicas)` for each returned workload handle. Implement it.
- [ ] **Step 4 (TDD)**: Write failing `job-runner.test.ts` cases for a `scale` operation: (a) an `argocd-app` target calls the new controller's `scale()`; (b) an `ecs` target calls `setDesiredCount`; (c) one target failing while another succeeds yields job status `partial_failure`, both applied targets still take effect; (d) all targets failing yields `failed`. Implement the `scale` branch in `job-runner.ts`, dispatching per target's resource type via the (now exported) `stepKey` helper.
- [ ] **Step 5 (TDD)**: Write a failing `poll-loop.ts` test asserting that `sweepRunningJobs`' restart recovery reconstructs a `scale` job's `targets` from the DDB job record (not from a re-derived/empty value), and that a fresh SQS enqueue for `scale` also carries `targets` in its `MessageBody`/`JobInput`. Implement the plumbing.
- [ ] **Step 6**: Commit: `feat(worker): add scale job operation with DDB-persisted targets and restart recovery`.

## Task 5: Backend — `scale` route (TDD)

**Files:**
- Test: `dashboard/backend/packages/api/src/__tests__/scale.test.ts`
- Create: `dashboard/backend/packages/api/src/routes/scale.ts`
- Modify: `dashboard/backend/packages/api/src/server.ts`

- [ ] **Step 1 (TDD)**: Write failing tests for `POST /api/projects/:owner/:name/actions/scale`: 409 when project status isn't `on`; 400 when `targets` is empty or has duplicate `stepKey`s; 400 when a target `stepKey` doesn't match any resource on the project; 400 when the matched resource's `type` isn't `ecs`/`argocd-app` or is `always_on`; 400 when a target is missing its type's required field (`desiredCount` for `ecs`, `replicas` for `argocd-app`) or carries the wrong one, or a non-positive-integer value; on success, creates a job record with `targets` persisted, enqueues one SQS message carrying the same `targets`, and returns `202 {job_id}` without changing project status.
- [ ] **Step 2**: Implement `routes/scale.ts` and register it in `server.ts` as a route distinct from the existing `:op` route (not a third `:op` value, since its body shape differs).
- [ ] **Step 3**: Commit: `feat(api): add POST .../actions/scale route`.

## Task 6: Backend — expose current resource values for pre-fill

**Files:**
- Modify: `dashboard/backend/packages/api/src/routes/projects.ts` (or wherever `GET /api/projects/:owner/:name` lives)
- Modify: `dashboard/backend/packages/api/src/__tests__/` (whichever test file already covers that route)

- [ ] **Step 1 (TDD)**: Write a failing test asserting the project-detail response includes a best-effort `current` value on `ecs`/`argocd-app` resources (current `desiredCount` via `DescribeServicesCommand`, current replica count via the existing ArgoCD workload/HPA read path), and that a failed live-read for one resource omits only that resource's `current` field without failing the whole response.
- [ ] **Step 2**: Implement the read, reusing existing AWS/ArgoCD client calls rather than adding new ones.
- [ ] **Step 3**: Commit: `feat(api): expose current desiredCount/replica values for demo-scale pre-fill`.

## Task 7: Frontend — scale UI

**Files:**
- Modify: `dashboard/frontend/lib/types.ts`
- Modify: `dashboard/frontend/lib/api.ts`
- Modify: `dashboard/frontend/hooks/useProjects.ts`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1**: Add `resource.current?: number` and scale-target types to `lib/types.ts`.
- [ ] **Step 2 (TDD)**: Write a test for a new `scale(repo, targets)` function in `useProjects.ts` — same POST → job_id → 1s-interval poll pattern as `toggle()`, resolving/toasting `succeeded`/`failed`/`partial_failure` distinctly.
- [ ] **Step 3**: Add `scaleProject` to `lib/api.ts` and implement `scale()` in `useProjects.ts`.
- [ ] **Step 4**: In `DetailDrawer.tsx`, for `argocd-app`/`ecs` resource chips, add a number input (pre-filled from `resource.current` when present, otherwise empty with a placeholder) and an "Apply" button; disable the input when project status isn't `on`.
- [ ] **Step 5**: Commit: `feat(frontend): per-resource demo-scale controls in the detail drawer`.
