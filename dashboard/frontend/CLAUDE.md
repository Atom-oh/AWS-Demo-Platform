# Dashboard frontend

Next.js 14 App Router and React 18 provide discovery and lifecycle controls for
configured projects. Read the [dashboard guide](../CLAUDE.md) for backend boundaries.
UI copy is Korean; repository documentation and code comments are English.
Keep the existing Next.js downgrade floor of 14.2.33 and align `next`/`eslint-config-next`;
[`package.json`](package.json) currently pins both to 14.2.35.

## Development

From `dashboard/frontend`, run `pnpm install`, then
`NEXT_PUBLIC_AUTH_ENABLED=false API_ORIGIN=http://localhost:8087 PORT=3001 pnpm dev`.
Start the local API from `dashboard/backend` with `pnpm -r build`, then
`PORT=8087 node packages/api/dist/dev-server.js`.

That dev server uses real Fastify routes and project YAML, but in-memory state,
simulated jobs and explicit auth bypass. It does not run the controllers,
persist HPA baselines or register history; the drawer's history request returns
404 there. Its fallback HTML at `/` is separate from this Next.js UI.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
[Frontend CI](../../.github/workflows/frontend-ci.yml) currently runs typecheck,
lint and build, **not Vitest**. Component/hook tests live in `components/__tests__/`
and `hooks/__tests__/`; the [Vitest config](vitest.config.mts) supplies jsdom,
alias resolution and automatic cleanup.

## Discovery and ordering (PR #107)

[`app/page.tsx`](app/page.tsx) defaults to [`ProjectTable`](components/ProjectTable.tsx)
and offers an optional card view. Both share search, facets and sorting:

| Sort | Order |
| --- | --- |
| Attention (default) | `error`, `unknown`, `transitioning`, `off`, `on`, `external`, then displayed name |
| Name | Displayed project name |
| Account | Account, then displayed name |

Name/account comparisons use Korean locale collation with numeric ordering and
case-insensitive comparison. Search is trimmed and case-insensitive across
project/displayed names, repository, description, account, resource types and
service labels. Category/account/status filters combine. Facet values sort by
count; facet counts and the stat strip cover all loaded rows.

Bulk actions consider only selected visible rows; select-all includes those rows,
while action counts include only eligible selections. Search, facet or view changes
clear selection and pending confirmation. Sort changes preserve them. Dashboard
Refresh dismisses confirmation but keeps selection for repositories still loaded.
Cards expose individual actions; the selection toolbar is table-only.

Projects with `management: external` are displayed as externally managed rather
than using platform bookkeeping status. Their API state is null; links and
metadata remain visible, but lifecycle/scale controls and bulk eligibility are
disabled. The API and worker enforce this boundary independently of the UI.
See [ADR-019](../../docs/decisions/ADR-019-externally-managed-projects.md).

## Operations, results and locks

[`useOperations`](hooks/useOperations.ts) coordinates lifecycle actions from the
table, cards and drawer, plus drawer scale requests. Bulk on accepts selected
`off`/`error` rows; bulk off accepts selected `on` rows. Confirmation snapshots
the operation, names and repositories. Dispatch deduplicates that snapshot and
rechecks each project's **latest loaded status**, not a fresh AWS/API read.
Later filtering or selection cannot widen a started batch; the API remains the
authoritative state guard.

At most four client attempts run at once, with one per project. A batch can start
only when no individual attempt is active; it blocks new individual lifecycle or
scale calls while running. Each completed dispatch immediately takes the next
queued target. These limits cover local POST/poll/refresh attempts, not the number
of backend jobs still executing.

[`OperationPanel`](components/OperationPanel.tsx) tracks the latest **bulk lifecycle
batch** as `queued`, `running`, `succeeded`, `failed` or `skipped`. Queued targets
have not yet been submitted; running covers a client attempt, not verified server
progress. Failure can mean backend failure, partial failure, request/poll error
or unconfirmed completion. Individual actions and scale use notifications instead
of adding panel entries.

Failed-item retry requires confirmation, uses the same operation and retains other
results. A no-longer-eligible retry keeps its original failure/message plus a retry
note rather than claiming a request ran. This matters for partial shutdowns already
stored as `off`. Results remain until dismissed or replaced by a new batch; they
cannot be cleared while that batch runs.

Queue, results and locks are **in-memory state in the mounted dashboard**. They
survive filters, view changes, drawer close/reopen and the dashboard Refresh action.
Browser reload, navigation/unmount or another tab does not restore/share them.
Unmounting prevents new queued submissions; accepted backend jobs are not cancelled.
There is no persisted batch/job-ID recovery. Local locks release when the client
attempt settles, including a polling timeout, so a backend job may still be running.

## Loading, detail and scale

[`useProjects`](hooks/useProjects.ts) loads the list/details and preserves
per-project request-start ordering across reloads and post-toggle refreshes. It
does not pin cached status while a mutation runs; a newer read can show older server
state, while `useOperations` still blocks another local mutation of that project.
Previously loaded rows stay visible during refresh or a list error, with mutation
controls disabled. Detail-read failure yields `unknown`. Refresh does not recover
job polling for transitions observed when the page loaded. The older `turnOnAll`
helper remains exported but is not used by this dashboard.

Toggle/scale polling makes up to 60 attempts with one-second delays and resolves
`{ok: boolean}`. A timeout does not cancel work. There is no continuous refresh,
SSE or WebSocket; stored lifecycle status and service-type labels are not live
health or capacity. Table rows show local active attempts as busy.

The drawer shows resource identifiers, plain-text briefing (2,000-character
preview), history and configured links. Non-toggleable/`always_on` resources have
exclusion text; ECS, EC2, ArgoCD and non-`always_on` RDS participate in lifecycle
actions. Native detail buttons open it; focus is trapped/restored, Escape closes
it and page scrolling is locked. Notifications render inside an open drawer;
success notices expire after 6.5s, errors persist until dismissed or replaced.

[`ScaleControl`](components/ScaleControl.tsx) starts blank and accepts integers
1–20 only while the project is `on` and actions are enabled. Its own submission
lock supplements the dashboard's per-project lock, which survives drawer reopening.
Keep `MAX_SCALE_COUNT` in [`lib/presentation.ts`](lib/presentation.ts) aligned with
backend [`MAX_SCALE_REPLICAS`](../backend/packages/shared/src/step-key.ts), and
[`lib/types.ts`](lib/types.ts) aligned with backend schemas/routes. Use API-supplied
`stepKey` values; current counts must be checked in ArgoCD/ECS.

HPA notices distinguish a saved baseline from a partially changed failed target.
Verify a failed first scale before another scale/off captures already-pinned bounds.
[ADR-017](../../docs/decisions/ADR-017-demo-scale-job-operation.md) owns recovery,
backend/cross-client races and the limits of the new local locks.

## API and auth

[`lib/api.ts`](lib/api.ts) uses relative `/api/*` paths and sends the access token.
The production verifier reads `username`, maps it to internal `cognito:username`,
and enforces the admin allowlist. ID-token claims are used for display.
[ADR-005](../../docs/decisions/ADR-005-cognito-spa-auth-code-pkce.md) covers PKCE,
token storage and independent frontend/backend bypasses.

| Request | Response / constraint |
| --- | --- |
| `GET /api/projects` | `{repo,name,account}[]` from configured YAML |
| `GET /api/projects/:owner/:name` | `{project,state}`; state may be null; resources include `stepKey` |
| `POST .../actions/{turn_on\|turn_off}` | `202 {job_id}`; on accepts off/error, off requires on; conflict is 409 |
| `POST .../actions/scale` | `{targets}` → `202 {job_id}`; requires on (409), validates targets (400) |
| `GET /api/jobs/:id` | Progress and status; terminal: succeeded, failed, partial_failure |
| `GET .../:owner/:name/history?limit=20` | `{items}`; stored job history, not live resource events |

[`next.config.mjs`](next.config.mjs) defines an unconditional API rewrite, used
for local development. Deployed CloudFront handles `/api/*` before Next.js;
[ADR-004](../../docs/decisions/ADR-004-same-origin-cloudfront-dashboard.md) defines
the origin policies. `NEXT_PUBLIC_*` values are baked into the image.

The [Dockerfile](Dockerfile) packages Next standalone on ARM64. CI publishes
`demo-platform/frontend`; it does not roll ECS. See the
[release runbook](../../docs/runbooks/review-and-release.md).

Secrets management, dynamic `ec2-tag` URL resolution, real-time updates and a
cookie BFF are unimplemented follow-ups. Explicit code-server URLs already work.
