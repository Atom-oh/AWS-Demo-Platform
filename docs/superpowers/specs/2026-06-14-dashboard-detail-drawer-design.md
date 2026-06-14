# Design Spec: Dashboard Detail Drawer + history endpoint (Sub-project A)

**Date:** 2026-06-14
**Status:** Proposed — brainstormed + consensus-reviewed (kiro-cli / codex / gemini panel, 2026-06-14, verdict REVIEW→fixes applied); pending user approval
**Scope:** Sub-project A of the dashboard feature expansion — turn the thin
list+toggle dashboard into one where clicking a project opens a detail drawer.
Decomposed from the 2026-06-09 ADR-vs-progress audit (B = Secret Manager UI,
D = GitHub discovery/onboarding are separate later sub-projects).

## Goal

A logged-in admin clicks a project card and sees, in a slide-in drawer: the
project's resources, its demo/code-server URLs, and its recent action history —
without leaving the grid. This is the single highest-leverage, lowest-risk step:
it mostly exposes backend capability that already exists (`HistoryClient.list`)
and adds one self-contained frontend component. No new AWS describe calls, no new
cross-account access.

## Non-goals (YAGNI for this sub-project)

- Live per-resource status (ECS desiredCount / EC2 running / RDS available) — would need new cross-account describe logic; deferred.
- Secret Manager UI (Sub-project B), GitHub discovery/onboarding views (Sub-project D).
- `code-server` `ec2-tag` resolution (Stage 4) — only `explicit` mode is rendered.
- URL deep-linking to a project (drawer state is client-only); real-time updates.

## Backend

### New endpoint: project action history

`GET /api/projects/:owner/:name/history?limit=20`

- Resolves `repo = owner/name`; 404 (`NotFoundError`) if the project is unknown (mirror `projects.ts`).
- Returns `historyClient.list(repo, limit)` — `HistoryClient.list` is already implemented in `shared/src/ddb/history.ts` (queries `pk = project#<repo>`, descending). No new query logic.
- `limit`: `parseInt`; if `NaN` / non-integer / `< 1` → default `20`; then clamp to `1..100` (DynamoDB `Limit` must be a positive integer).
- Response: the route **maps** each `HistoryRecord` to a clean wire shape `{ action, actor, account, result, details?, ts }` — `ts` is the ISO timestamp derived from the record's `sk` (`sk.split('#')[0]`); `pk`/`gsi*`/`ttl` are **stripped**. The frontend is a separate package and cannot import `@demo-platform/shared`, so it defines a matching `HistoryRecord` type; the wire shape (not a shared import) keeps the two in sync. `list` returns `[]` for a project with no history (no throw).

### Wiring

- `server.ts` prod entry: construct `HistoryClient({ doc, tableName: requireEnv('DDB_TABLE_HISTORY') })` and pass it to `buildServer`.
- `buildServer`: add `historyClient?: HistoryClient` to `BuildServerOpts`; register the history route only when `opts.projects && opts.historyClient` are present (same gating style as projects/actions).
- `routes/history.ts`: new file, mirrors `routes/jobs.ts` shape. All relative imports use `.js` extensions (Node16 ESM).

### Infra / IAM

- `infra/dashboard-ecs/main.tf`: add `{ name = "DDB_TABLE_HISTORY", value = "demo-platform-history-dev" }` to the **api** task definition env (verified missing from api, present on worker).
- IAM: **no change needed** — `infra/iam/dashboard-ecs-task-role.tf` already includes `local.ddb_history_arn` in the `DynamoDbState` statement (verified via the consensus panel), so the api (same `DashboardEcsTaskRole-dev`) can `Query` the history table.

### Tests

- `packages/api/src/__tests__/history.test.ts`: build the server with a mock `historyClient`, assert `GET /api/projects/o/r/history` returns the listed items, passes the clamped limit, and 404s for an unknown repo.

## Frontend

### Types + api client

- `lib/types.ts`: extend `Project.urls` with `code_server?: { mode: 'explicit'; url: string } | { mode: 'ec2-tag'; tag: string }` (matches the backend schema; the drawer renders only `explicit`). Add `HistoryRecord` (`action`, `actor`, `account`, `result: 'success'|'partial'|'failure'`, `details?`, `sk`).
- `lib/api.ts`: add `getHistory(owner, name, limit = 20): Promise<{ items: HistoryRecord[] }>` — `encodeURIComponent` each path segment; Bearer attached by the existing `req`.

### `components/DetailDrawer.tsx` (new, self-contained)

- Props: `{ row: ProjectRow; onClose: () => void; onToggle: (repo, op) => void }`.
- Right-side slide-in panel + a click-catching backdrop; `Esc` and backdrop click close it.
- On mount: `getHistory(owner, name)` (the project + state already live in `row` from `useProjects`, so no extra detail fetch is required). Local `loading`/`error` for the history section only; ignore the resolved promise if the drawer unmounts mid-fetch (no setState on unmounted).
- **Null-project guard:** `useProjects` can yield `project: null` (per-project detail fetch failed). The drawer must NOT assume `row.project` is non-null — it renders an "details unavailable" state for the header/resources/URLs sections in that case (history still loads). (Equivalently, the card-open handler may skip rows with `project === null`.)
- **Accessibility:** the panel is `role="dialog"` + `aria-modal`, traps focus while open, returns focus to the originating card on close, and closes on `Esc`/backdrop.
- **Refresh on toggle:** when a toggle started from the drawer reaches `succeeded`/`failed`, re-fetch history once so the just-performed action appears (real-time updates stay a non-goal).
- Sections:
  1. **Header** — name, `repo` (mono), account/category chips, status pill, the existing Turn on/off button (reuses `onToggle`).
  2. **Resources** — list each `project.resources` entry: type label + identifier (`cluster/service`, `instance_ids`, `db_identifier`, `application`, …) and a toggleable-vs-always-on marker. Static (no live status).
  3. **URLs** — demo link (open ↗) and code-server link when `urls.code_server.mode === 'explicit'`; muted placeholder otherwise.
  4. **History** — timeline from `getHistory`: per record an action label, a result badge (success/partial/failure), actor, relative time, and expandable `details`/errors. Empty-state and error-state messages.

### `app/page.tsx` integration

- Add `selected: string | null` (the repo). Render `<DetailDrawer row={...} .../>` when `selected` is set.
- `ProjectCard`: clicking the **card body** sets `selected` (opens the drawer); the existing interactive controls (Turn on/off button, demo link) call `e.stopPropagation()` so they don't also open the drawer. Add `role="button"` + keyboard (Enter/Space) on the card body for accessibility.
- If `selected` no longer exists in `rows` after a reload/filter change, clear it (close the drawer) so it can't point at a vanished project.

### `app/globals.css`

- Drawer + backdrop (slide-in transition), section headers, resource rows, and a history timeline (result-badge colors reuse the existing `--on/--warn/--err` tokens).

## Data flow

```text
card body click → page.selected=repo
DetailDrawer mount → getHistory(owner,name) → GET /api/projects/:o/:n/history (Bearer)
                     api → historyClient.list(repo, limit) → DDB history table (Query DESC)
drawer renders project (from row) + history (from fetch); toggle reuses useProjects.toggle
```

## Error handling

- History fetch failure → the History section shows an inline error (the rest of the drawer still renders from `row`).
- Unknown repo → 404 from the endpoint (shouldn't happen for a card that exists; handled defensively).
- Auth: same Bearer path as other `/api/*` calls; a 401 surfaces like the existing list error.

## Testing & verification

- Backend: `pnpm -r build` (tsc gate) + the new `history.test.ts` + existing api tests; `pnpm -r lint`. `history.test.ts` covers: happy path, the response **mapping** (no `pk`/`ttl`, `ts` derived from `sk`), malformed `limit` (NaN/negative/non-int → default), and 404 for an unknown repo.
- Frontend: `pnpm typecheck` + `pnpm lint` + `pnpm build`; runtime smoke against the dev-server (drawer opens, history renders, toggle still works) with a screenshot.
- Infra: `terraform validate` for `infra/dashboard-ecs` (+ `infra/iam` if the read perm is added).

## Deploy

Two PRs through the established flow:
1. Backend — history route + `DDB_TABLE_HISTORY` env (+ task-role read if needed): merge → api image rebuild → `atlantis apply -d infra/dashboard-ecs` (+ `-d infra/iam` if changed) → `aws ecs update-service ... demo-platform-api-dev --task-definition <new ARM64 rev> --force-new-deployment`.
2. Frontend — types + api + DetailDrawer + page wiring + CSS: merge → frontend image rebuild → `update-service ... demo-platform-frontend-dev --force-new-deployment`.

(Frontend-only is the bulk; the backend change is one thin route + one env var.)

> **Rollout note (verified):** the **frontend** change is image-only — the task-def is unchanged, so a bare `--force-new-deployment` correctly re-pulls `:main-latest`. The **api** change *does* alter the task-def (new `DDB_TABLE_HISTORY` env) → a new revision is registered, so pin it: `--task-definition demo-platform-api-dev:<new ARM64 rev>` (per the `ignore_changes=[task_definition]` mandate — a bare force-deploy would keep the old rev).

## Component boundaries

- `routes/history.ts` depends only on `historyClient` (shared) — thin, testable in isolation.
- `DetailDrawer` depends only on `lib/api.ts` + the `ProjectRow` it's handed — no business logic, no AWS, reusable.
- `useProjects` is unchanged except the page passes its `toggle` into the drawer.
