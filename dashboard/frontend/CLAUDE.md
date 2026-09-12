# dashboard/frontend — Stage 3 Admin UI (MVP)

Next.js 14 (App Router, TypeScript) dashboard for the AWS Demo Platform.
Master-detail discovery + lifecycle control over the projects the backend manages.

## Status
**MVP — dev only.** Renders the live project list, faceted discovery, on/off
toggles, a detail drawer (resources, GitHub repo link, briefing, history), a
confirmed bulk start scoped to visible eligible projects, and per-resource demo-scale controls (ArgoCD/HPA
replicas, ECS `desiredCount` — see [ADR-017](../../docs/decisions/ADR-017-demo-scale-job-operation.md))
against the backend API. ECS Fargate and same-origin CloudFront routing are already
defined. Code on main and an image pushed to ECR do not prove that the running
service uses the latest revision; verify deployment separately.

## Run (from `dashboard/frontend/`)
Install dependencies with `pnpm install`. For local dev, run `NEXT_PUBLIC_AUTH_ENABLED=false API_ORIGIN=http://localhost:8087 PORT=3001 pnpm dev` with the dev API already up. Auth is enabled unless the flag is literally `false`; `.env.local.example` provides the same local setting if copied to `.env.local`. `pnpm build` produces the production build, `pnpm typecheck` runs `tsc --noEmit`, and `pnpm lint` runs `next lint`.

The backend API in dev is the **dev-server** (`dashboard/backend`, see below),
not the deployed `admin-api-dev`.

## How it talks to the API
- All data goes through **same-origin `/api/*`**. `next.config.mjs` `rewrites()`
  proxies `/api/*` → `${API_ORIGIN}` (default `http://localhost:8087`) in dev.
- In the deployed path, one CloudFront distribution has separate frontend and API
  origins. `/api/*` is routed to the API before it reaches Next.js, using
  `AllViewerExceptHostHeader` and disabled caching. The local rewrite is not the
  production routing mechanism; client requests remain same-origin.
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
client component — search + filters + grid + notifications + confirmed visible-project start), and
`globals.css` (responsive dark theme, reduced-motion support). `components/` holds `StatStrip.tsx` (totals for
projects / accounts / on / off), `FacetSidebar.tsx` (category / account /
status facets with counts, collapsible on mobile), `ProjectCard.tsx` (one project: status pill,
service chips, a native detail button, toggle, GitHub link and demo link), and `DetailDrawer.tsx`
(resources with per-resource scale controls, GitHub link, briefing, URLs,
history timeline). `ScaleControl.tsx` owns labeled 1–20 inputs, in-flight duplicate
prevention while mounted, and inline completion/failure feedback. `Icon.tsx` holds
small shared SVG icons; `lib/presentation.ts` holds status/service labels and scale
help text. `hooks/useProjects.ts` loads the list and details and
drives `toggle()` (always resolves `{ok: boolean}`, never rejects),
`turnOnAll()` (fixed concurrency of 4; the page supplies visible off/error rows only), and `scale()` — all with job polling.
`lib/api.ts` holds the fetch helpers (`/api/projects`, `/actions/:op`,
`/actions/scale`, `/jobs/:id`), and `lib/types.ts` holds the `Project` /
`ProjectRow` / `Job` / `Status` / `ScaleTarget` types, mirroring the backend
shapes (`ResourceRef.stepKey` is echoed by the api, never computed here).

## Demo workflow

Search trims surrounding whitespace and matches project, repo, account, description
and resource type. Reset clears search and all facets. Refresh/retry reloads the
API list, including transitions observed before this page started. An `on` state is the
last observed lifecycle status, not a service health check.

Bulk start shows the eligible count and asks for confirmation with project names.
Changing the search/facets dismisses that confirmation. Project cards use native
buttons for detail access, avoiding nested interactive elements inside a button.
The drawer traps keyboard focus, restores focus on close and locks page scrolling.
Error notifications remain until dismissed; successful ones expire after 6.5s.
Notifications render inside an open drawer so their dismissal stays keyboard-accessible.
HPA help explains that scale pins its range and a later off/on cycle restores the
persisted original baseline, matching ADR-017.

## API contract consumed (must match `@demo-platform/api`)
- `GET /api/projects` → `{repo,name,account}[]`
- `GET /api/projects/:owner/:name` → `{project, state:{status}}` — each
  `project.resources[]` entry carries its `stepKey`, computed the same way the
  worker computes it
- `POST /api/projects/:owner/:name/actions/{turn_on|turn_off}` → `202 {job_id}`
  (409 if already in target state)
- `POST /api/projects/:owner/:name/actions/scale` (`{targets: ScaleTarget[]}`)
  → `202 {job_id}` (409 if project isn't `on`, 400 on target validation
  failure) — see [ADR-017](../../docs/decisions/ADR-017-demo-scale-job-operation.md)
- `GET /api/jobs/:id` → `{status, progress, error, ...}` (terminal statuses include `succeeded`, `failed` and `partial_failure`)

## Conventions
TypeScript strict throughout. `lib/types.ts` mirrors the backend Zod schemas, so
it needs to stay in sync whenever the API shape changes. Toggleable resource
types are `ecs`, `ec2`, `argocd-app`, `rds`; others render as
always-on/visibility-only chips. `package.json` pins Next at `14.2.35`; the existing
repository downgrade floor is `14.2.33`. This records a dependency constraint, not
a current security-support assessment. Review advisories separately when changing
dependencies and keep the Next/ESLint configuration versions aligned.

## Auth (Cognito)
- **Authorization Code + PKCE** against the Hosted UI (public SPA client, no secret).
  `lib/auth.ts` (login/exchange/refresh/logout), `lib/pkce.ts` (Web Crypto),
  `lib/token-store.ts` (access/id in memory, refresh in sessionStorage),
  `components/AuthProvider.tsx` (`useAuth`, silent refresh ~60s before exp),
  `components/LoginGate.tsx` (gates the dashboard), `app/auth/callback/page.tsx`.
- `lib/api.ts` sends the **ACCESS token** as `Authorization: Bearer` (the api
  verifies `tokenUse:'access'` and matches `cognito:username` vs `ADMIN_USERNAMES`).
- `NEXT_PUBLIC_*` (see `.env.local.example`) are **build-time inlined**. The deployed
  image receives the configured Cognito values as build args.
  `NEXT_PUBLIC_AUTH_ENABLED=false` bypasses the local login UI; it does not weaken
  the API's independent JWT enforcement. Without an access token, calls to the
  deployed API still return 401. For local Cognito testing, configure real client
  and callback values matching the chosen port instead of using the bypass.
- Deploy build: **arm64/Graviton** — `frontend-ci` builds `--platform=linux/arm64` on the
  `aws-demo-platform-arm` self-hosted runner; frontend task `cpu_architecture=ARM64`,
  consistent with api/worker after the PR #16 Graviton migration landed on main.

## Image & deploy
- `Dockerfile` (Next standalone, `PORT=3000`, `HOSTNAME=0.0.0.0`), `output:'standalone'`.
- ECR repo `demo-platform/frontend`; built/pushed by `.github/workflows/frontend-ci.yml`.
- Runtime infra: `infra/dashboard-ecs` frontend service + `infra/alb-internal` TG
  (priority 130) + `infra/cloudfront` same-origin distribution (`/api/*`→api) +
  `infra/route53-private-zone` public alias `admin-dev.atomai.click`.
- Image CI does not roll ECS services. Select an explicit task-definition revision
  and verify running tasks, TLS, login and authenticated API access after rollout.

## Tests
`pnpm test` runs vitest (`vitest.config.mts` — jsdom, `vite-tsconfig-paths` for
`@/*` resolution, `globals: true` so `@testing-library/react`'s `afterEach`
auto-cleanup runs between tests). Component tests live under
`components/__tests__/`, hook tests under `hooks/__tests__/`.

## Not yet done (follow-ups)
- Secrets management UI and dynamic `ec2-tag` code-server resolution. Explicit
  code-server URLs already render in the drawer.
- Real-time updates (SSE/WebSocket) instead of poll-on-toggle
- Token storage hardening (httpOnly cookie BFF): the current in-memory/sessionStorage
  approach is XSS-exposed, which is acceptable for a single-admin non-prod tool but
  is the reason a BFF is the eventual target
