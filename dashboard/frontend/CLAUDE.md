# dashboard/frontend — Stage 3 Admin UI (MVP)

Next.js 14 (App Router, TypeScript) dashboard for the AWS Demo Platform.
Master-detail discovery + lifecycle control over the projects the backend manages.

## Status
**MVP — dev only.** Renders the live project list, faceted discovery, and
working on/off toggles against the backend API. Not yet deployed (Stage 3 target
is ECS Fargate behind the same CloudFront origin as `api`).

## Run (from `dashboard/frontend/`)
```bash
pnpm install
API_ORIGIN=http://localhost:8087 PORT=3001 pnpm dev   # needs the dev API up
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
```
The backend API in dev is the **dev-server** (`dashboard/backend`, see below),
not the deployed `admin-api-dev`.

## How it talks to the API
- All data goes through **same-origin `/api/*`**. `next.config.mjs` `rewrites()`
  proxies `/api/*` → `${API_ORIGIN}` (default `http://localhost:8087`) in dev.
- In prod (Stage 3) `api` and the frontend sit behind one CloudFront origin, so
  `/api/*` is genuinely same-origin and the rewrite is a no-op — **no CORS, no
  hardcoded API host in client code.**
- No AWS SDK in the frontend; every cross-account op goes through the backend
  (per `../CLAUDE.md`).

## Backing API in dev: `dashboard/backend` dev-server
`packages/api/src/dev-server.ts` runs the **real Fastify API** with in-memory
State/Jobs clients and a fake SQS that **simulates the worker** so toggles
complete end-to-end. Data is real (`projects/*.yaml`); resource state is
simulated. It also serves a no-build vanilla fallback dashboard at `/`
(`dashboard/backend/dev/dashboard.html`) — the prototype this app was ported from.
```bash
cd dashboard/backend && pnpm -r build
PORT=8087 node packages/api/dist/dev-server.js
```

## Structure
```
app/
  layout.tsx        root layout + globals.css
  page.tsx          dashboard (client) — search + filters + grid + toast
  globals.css       dark theme
components/
  StatStrip.tsx     totals (projects / accounts / on / off)
  FacetSidebar.tsx  category / account / status facets with counts
  ProjectCard.tsx   one project: status pill, resource chips, toggle, demo link
hooks/
  useProjects.ts    load list+details, toggle with job polling
lib/
  api.ts            fetch helpers (/api/projects, /actions/:op, /jobs/:id)
  types.ts          Project / ProjectRow / Job / Status (mirror backend shapes)
```

## API contract consumed (must match `@demo-platform/api`)
- `GET /api/projects` → `{repo,name,account}[]`
- `GET /api/projects/:owner/:name` → `{project, state:{status}}`
- `POST /api/projects/:owner/:name/actions/{turn_on|turn_off}` → `202 {job_id}`
  (409 if already in target state)
- `GET /api/jobs/:id` → `{status, progress, error, ...}` (poll until succeeded/failed)

## Conventions
- TypeScript strict. `lib/types.ts` mirrors the backend Zod schemas — keep in
  sync if the API shape changes.
- Toggleable resource types: `ecs`, `ec2`, `argocd-app`, `rds` (others render as
  always-on/visibility-only chips).
- Pinned to Next `14.2.35` (patched; do not downgrade below 14.2.33 — security advisory).

## Not yet done (follow-ups)
- Detail view (per-project drawer: resources, secrets, code-server URL, job history)
- Cognito hosted-UI login (dev uses the API's `skipJwt`)
- Real-time updates (SSE/WebSocket) instead of poll-on-toggle
- ECS Fargate deploy (`infra/dashboard-ecs` adds a frontend service + CF behavior)
