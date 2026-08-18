# Demo Readiness UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator four things ahead of a live demo: a bulk "turn on all" action, a clickable GitHub repo link, a free-text briefing field, and an operator-driven "scale for demo" control (ArgoCD replica count / ECS `desiredCount`) independent of the existing on/off restoration flow.

**Architecture:** Reuses the existing async job model (ADR-001). Three features (bulk turn-on, GitHub link, briefing) are frontend/schema-only. The fourth (scale) adds a new job `operation: 'scale'`, a new route, a `job-runner.ts` branch reusing the existing ArgoCD controller methods plus a new standalone ECS `setDesiredCount`, independent of the turn_on/turn_off restoration-data bookkeeping.

**Tech Stack:** Backend — Node20 TS pnpm-workspace (Fastify, vitest, Node16 ESM `.js` imports). Frontend — Next.js 14 App Router, TS. Spec: `docs/superpowers/specs/2026-08-18-demo-readiness-ui-design.md`. Branch: `feat/demo-readiness-ui`.

**Four deliverable units** → four PRs, each independently green: Task 1 (GitHub link), Task 2 (briefing field), Task 3 (bulk turn-on), Tasks 4–6 (scale action, backend then frontend).

---

## File structure

**Backend** (`dashboard/backend/`)
- Modify `packages/shared/src/schemas/project.ts` — add `briefing?: string`.
- Modify `packages/shared/src/schemas/job.ts` (or wherever `JobRecordSchema.operation` lives) — add `'scale'` to the operation enum.
- Create `packages/api/src/routes/scale.ts` — new `POST /api/projects/:owner/:name/actions/scale` route.
- Create `packages/api/src/__tests__/scale.test.ts` — route test.
- Modify `packages/api/src/server.ts` — register the new route.
- Modify `packages/worker/src/job-runner.ts` — add the `scale` operation branch.
- Modify `packages/worker/src/controllers/ecs.ts` — add `setDesiredCount({cluster, service, count})`.
- Modify `packages/worker/src/__tests__/job-runner.test.ts` and `ecs.test.ts` — new-branch coverage.

**Frontend** (`dashboard/frontend/`)
- Modify `components/ProjectCard.tsx` — wrap repo text in a GitHub link.
- Modify `components/DetailDrawer.tsx` — GitHub link, briefing section, per-resource scale inputs.
- Modify `lib/types.ts` — `Project.briefing`, scale request/response types.
- Modify `lib/api.ts` — `scaleProject`.
- Modify `hooks/useProjects.ts` — `scale()` function; bulk-turn-on helper.
- Modify `app/page.tsx` — "Turn on all" button near `StatStrip`.
- Modify `app/globals.css` — styles for the new drawer sections/inputs.

---

## Task 1: GitHub repo link (frontend-only)

**Files:**
- Modify: `dashboard/frontend/components/ProjectCard.tsx`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`

- [ ] **Step 1**: In both components, wrap the existing repo-text element in `<a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">`, keeping the same visible text and CSS class so no layout changes.
- [ ] **Step 2**: Add/extend a component test (or snapshot) asserting the anchor's `href` for a known `repo` value.
- [ ] **Step 3**: Commit: `feat(frontend): clickable GitHub repo link on card and drawer`.

## Task 2: Briefing field (schema + frontend display)

**Files:**
- Modify: `dashboard/backend/packages/shared/src/schemas/project.ts`
- Modify: `dashboard/frontend/lib/types.ts`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1 (TDD, backend)**: Add a schema test asserting `briefing` is optional, accepts a multi-line string, and that a project YAML without it still parses.
- [ ] **Step 2**: Add `briefing: z.string().max(2000).optional()` to `ProjectSchema`.
- [ ] **Step 3 (frontend)**: Add `briefing?: string` to the `Project` type in `lib/types.ts`.
- [ ] **Step 4**: Add a "Briefing" section to `DetailDrawer.tsx`, rendered only when `briefing` is truthy, using `white-space: pre-wrap` styling to preserve line breaks; place it alongside the existing Resources/URL/History sections.
- [ ] **Step 5**: Commit: `feat: add optional project briefing field, shown in the detail drawer`.

## Task 3: Bulk "turn on all" (frontend-only)

**Files:**
- Modify: `dashboard/frontend/hooks/useProjects.ts`
- Modify: `dashboard/frontend/app/page.tsx`

- [ ] **Step 1 (TDD)**: Write a test for a new `turnOnAll()` helper in `useProjects.ts` — given a mixed list of project statuses, it calls `toggle(repo, 'turn_on')` only for `off`/`error` projects, at most N (e.g. 4) concurrently, and resolves with a list of `{repo, ok}` results even when some calls fail.
- [ ] **Step 2**: Implement `turnOnAll()` using a small concurrency-limited batching helper (no new dependency — a simple chunked `Promise.all` loop is sufficient).
- [ ] **Step 3**: Add a "Turn on all" button in `app/page.tsx` near `StatStrip`; on click, call `turnOnAll()`, then toast a summary ("N개 켜짐, M개 실패: repoA, repoB" or the all-success case).
- [ ] **Step 4**: Commit: `feat(frontend): bulk "turn on all" action for off/error projects`.

## Task 4: Backend — `scale` job operation (TDD)

**Files:**
- Test: `dashboard/backend/packages/worker/src/__tests__/job-runner.test.ts`, `ecs.test.ts`
- Modify: `dashboard/backend/packages/shared/src/schemas/job.ts`
- Modify: `dashboard/backend/packages/worker/src/controllers/ecs.ts`
- Modify: `dashboard/backend/packages/worker/src/job-runner.ts`

- [ ] **Step 1 (TDD)**: Write a failing `ecs.test.ts` case for a new `setDesiredCount({cluster, service, count})` that calls `UpdateServiceCommand` with the given count and does not touch any restoration-data bookkeeping.
- [ ] **Step 2**: Implement `setDesiredCount` in `controllers/ecs.ts`.
- [ ] **Step 3 (TDD)**: Write failing `job-runner.test.ts` cases for a `scale` operation: (a) an `argocd-app` target calls `patchHpaBounds({min:n,max:n})` + `patchReplicas(n)`; (b) an `ecs` target calls `setDesiredCount`; (c) one target failing while another succeeds yields job status `partial_failure`, both applied targets still take effect.
- [ ] **Step 4**: Add `'scale'` to the job `operation` enum; implement the `scale` branch in `job-runner.ts`, dispatching per target's resource type via its `stepKey`.
- [ ] **Step 5**: Commit: `feat(worker): add scale job operation for argocd and ecs resources`.

## Task 5: Backend — `scale` route (TDD)

**Files:**
- Test: `dashboard/backend/packages/api/src/__tests__/scale.test.ts`
- Create: `dashboard/backend/packages/api/src/routes/scale.ts`
- Modify: `dashboard/backend/packages/api/src/server.ts`

- [ ] **Step 1 (TDD)**: Write failing tests for `POST /api/projects/:owner/:name/actions/scale`: rejects with 409 when project status isn't `on`; rejects with 400 when a target `stepKey` doesn't match any resource on the project or matches an `always_on` resource; rejects non-positive-integer target values; on success, creates a job record, enqueues one SQS message shaped `{jobId, repo, operation:'scale', targets}`, and returns `202 {job_id}` without changing project status.
- [ ] **Step 2**: Implement `routes/scale.ts` and register it in `server.ts`.
- [ ] **Step 3**: Commit: `feat(api): add POST .../actions/scale route`.

## Task 6: Frontend — scale UI

**Files:**
- Modify: `dashboard/frontend/lib/api.ts`
- Modify: `dashboard/frontend/hooks/useProjects.ts`
- Modify: `dashboard/frontend/components/DetailDrawer.tsx`
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1 (TDD)**: Write a test for a new `scale(repo, targets)` function in `useProjects.ts` — same POST → job_id → 1s-interval poll pattern as `toggle()`, resolving/toasting on `succeeded`/`failed`/`partial_failure`.
- [ ] **Step 2**: Add `scaleProject` to `lib/api.ts` and implement `scale()` in `useProjects.ts`.
- [ ] **Step 3**: In `DetailDrawer.tsx`, for `argocd-app`/`ecs` resource chips, add a number input (pre-filled with the current known value) and an "Apply" button; disable the input when project status isn't `on`.
- [ ] **Step 4**: Commit: `feat(frontend): per-resource demo-scale controls in the detail drawer`.
