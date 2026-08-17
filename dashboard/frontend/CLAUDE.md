# dashboard/frontend — Stage 3 Admin UI (MVP)

Next.js 14 (App Router, TypeScript) dashboard for the AWS Demo Platform.
Master-detail discovery + lifecycle control over the projects the backend manages.

## Status
**MVP — dev only.** Renders the live project list, faceted discovery, and
working on/off toggles against the backend API. Not yet deployed (Stage 3 target
is ECS Fargate behind the same CloudFront origin as `api`).

## Run (from `dashboard/frontend/`)
Install dependencies with `pnpm install`. For local dev, run `API_ORIGIN=http://localhost:8087 PORT=3001 pnpm dev` with the dev API already up. `pnpm build` produces the production build, `pnpm typecheck` runs `tsc --noEmit`, and `pnpm lint` runs `next lint`.

The backend API in dev is the **dev-server** (`dashboard/backend`, see below),
not the deployed `admin-api-dev`.

## How it talks to the API
- All data goes through **same-origin `/api/*`**. `next.config.mjs` `rewrites()`
  proxies `/api/*` → `${API_ORIGIN}` (default `http://localhost:8087`) in dev.
- In prod (Stage 3) `api` and the frontend sit behind one CloudFront origin, so
  `/api/*` is genuinely same-origin and the rewrite is a no-op — the goal this
  achieves is no CORS handling and no hardcoded API host anywhere in client code.
- The frontend carries no AWS SDK; every cross-account operation is routed
  through the backend instead (per `../CLAUDE.md`).

## Backing API in dev: `dashboard/backend` dev-server
`packages/api/src/dev-server.ts` runs the **real Fastify API** with in-memory
State/Jobs clients and a fake SQS that **simulates the worker** so toggles
complete end-to-end. Data is real (`projects/*.yaml`); resource state is
simulated. It also serves a no-build vanilla fallback dashboard at `/`
(`dashboard/backend/dev/dashboard.html`) — the prototype this app was ported from.
To run it: from `dashboard/backend`, run `pnpm -r build`, then start it with
`PORT=8087 node packages/api/dist/dev-server.js`.

## Structure
`app/` holds `layout.tsx` (root layout + globals.css), `page.tsx` (the dashboard
client component — search + filters + grid + toast), and `globals.css` (dark
theme). `components/` holds `StatStrip.tsx` (totals for projects / accounts /
on / off), `FacetSidebar.tsx` (category / account / status facets with counts),
and `ProjectCard.tsx` (one project: status pill, resource chips, toggle, demo
link). `hooks/useProjects.ts` loads the list and details and drives toggle with
job polling. `lib/api.ts` holds the fetch helpers (`/api/projects`,
`/actions/:op`, `/jobs/:id`), and `lib/types.ts` holds the `Project` /
`ProjectRow` / `Job` / `Status` types, mirroring the backend shapes.

## API contract consumed (must match `@demo-platform/api`)
- `GET /api/projects` → `{repo,name,account}[]`
- `GET /api/projects/:owner/:name` → `{project, state:{status}}`
- `POST /api/projects/:owner/:name/actions/{turn_on|turn_off}` → `202 {job_id}`
  (409 if already in target state)
- `GET /api/jobs/:id` → `{status, progress, error, ...}` (poll until succeeded/failed)

## Conventions
TypeScript strict throughout. `lib/types.ts` mirrors the backend Zod schemas, so
it needs to stay in sync whenever the API shape changes. Toggleable resource
types are `ecs`, `ec2`, `argocd-app`, `rds`; others render as
always-on/visibility-only chips. The Next version is pinned at `14.2.35`
(patched) — the floor is `14.2.33`, tied to a security advisory, so any
downgrade needs to stay above that line.

## Auth (Cognito)
- **Authorization Code + PKCE** against the Hosted UI (public SPA client, no secret).
  `lib/auth.ts` (login/exchange/refresh/logout), `lib/pkce.ts` (Web Crypto),
  `lib/token-store.ts` (access/id in memory, refresh in sessionStorage),
  `components/AuthProvider.tsx` (`useAuth`, silent refresh ~60s before exp),
  `components/LoginGate.tsx` (gates the dashboard), `app/auth/callback/page.tsx`.
- `lib/api.ts` sends the **ACCESS token** as `Authorization: Bearer` (the api
  verifies `tokenUse:'access'` and matches `cognito:username` vs `ADMIN_USERNAMES`).
- `NEXT_PUBLIC_*` (see `.env.local.example`) are **build-time inlined** — the prod
  image is built with prod values as build args. `NEXT_PUBLIC_AUTH_ENABLED=false`
  is the local-dev bypass, mirroring the api's `skipJwt`.
- Deploy build: **arm64/Graviton** — `frontend-ci` builds `--platform=linux/arm64` on the
  `aws-demo-platform-arm` self-hosted runner; frontend task `cpu_architecture=ARM64`,
  consistent with api/worker after the PR #16 Graviton migration landed on main.

## Image & deploy
- `Dockerfile` (Next standalone, `PORT=3000`, `HOSTNAME=0.0.0.0`), `output:'standalone'`.
- ECR repo `demo-platform/frontend`; built/pushed by `.github/workflows/frontend-ci.yml`.
- Runtime infra: `infra/dashboard-ecs` frontend service + `infra/alb-internal` TG
  (priority 130) + `infra/cloudfront` same-origin distribution (`/api/*`→api) +
  `infra/route53-private-zone` public alias `admin-dev.atomai.click`.

## Not yet done (follow-ups)
- Detail view (per-project drawer: resources, secrets, code-server URL, job history)
- Real-time updates (SSE/WebSocket) instead of poll-on-toggle
- Token storage hardening (httpOnly cookie BFF): the current in-memory/sessionStorage
  approach is XSS-exposed, which is acceptable for a single-admin non-prod tool but
  is the reason a BFF is the eventual target
