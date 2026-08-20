# dashboard/ Module

## Role
Stage 2–3 admin platform for AWS Demo Platform.
- **`backend/`** — Stage 2 **Lifecycle Controller**. Node.js TypeScript pnpm-workspaces monorepo, built and deployed (dev).
- **`frontend/`** — Stage 3 admin UI (Next.js 14, App Router). **MVP built (dev only):** live project list, faceted discovery, on/off toggles, detail drawer (resources, GitHub link, briefing, history), bulk turn-on-all, and per-resource demo-scale controls — via same-origin `/api/*` proxy. See `frontend/CLAUDE.md`.

## backend/ — Lifecycle Controller (implemented)

pnpm workspaces monorepo. Three packages:

| Package | Role |
|---|---|
| `@demo-platform/shared` | Zod schemas (project/account/DDB records), `stepKey` + `MAX_SCALE_REPLICAS`, pino logger, env loaders, AWS SDK client factory, AssumeRole cache (TTL skew), DDB clients (state/jobs/history), ArgoCD REST client, GitHub client |
| `@demo-platform/api` | Fastify REST API: `/health`, `/api/projects`, `/api/projects/*`, `.../actions/{turn_on,turn_off,scale}`, `/api/jobs/:id`. Cognito JWT plugin (skip in `NODE_ENV=development`), projects-loader, error handler |
| `@demo-platform/worker` | SQS consumer + startup sweep, 4 resource controllers (ECS/EC2/RDS/ArgoCD HPA-2) plus `scale` support (`EcsController.setDesiredCount`, `ArgocdController.scale`), runJob dispatcher, GitHub discoverer (hourly cron) |

### Commands (run from `dashboard/backend/`)

Install dependencies with `pnpm install`. `pnpm test` runs vitest — unit tests plus LocalStack integration tests, which need the stack up first. `pnpm typecheck` runs `tsc --noEmit` across all three packages, and `pnpm lint` runs eslint. `pnpm build` compiles via `tsc -b` into `dist/`. `pnpm stack:up` brings up LocalStack on `:4566` (`docker compose up -d`) for the integration tests; `pnpm stack:down` tears it back down.

Docker images build per-package: `docker build -f packages/{api,worker}/Dockerfile -t demo-platform-{api,worker}:dev .`

### Non-obvious patterns
- **Node16 ESM**: relative imports rely on `.js` extensions to resolve; `tsc -b` is the real typecheck gate, since vitest and esbuild both skip type errors.
- **AssumeRole flow**: the worker assumes `DemoPlatformOperator` per `accounts.yaml`, using the ExternalId stored in Secrets Manager; creds are cached with TTL skew.
- **HPA-2 (ArgoCD controller)**: the goal of `turn_off` is a scaled-down state that ArgoCD won't fight, so it patches HPA `min=max=1` plus Deployment `replicas=1` rather than a true zero.
- **turn_on restores resources**: `worker/src/job-runner.ts` reads `restoration_data` off the DDB state record and dispatches per-resource into each controller's `turnOn(rd)` (ECS desiredCount / EC2 start / RDS start / ArgoCD HPA-2 restore). RDS `waitForAvailable` is fire-and-forget. Restoration keys each entry by a **unique per-resource `stepKey`** (e.g. `argocd-app:<application>`) so that same-type resources don't collide. A partial `turn_on` failure calls `markError`, which preserves `restoration_data` for retry, instead of `markOn`.
- **Job model**: the api enqueues to SQS and the worker processes idempotently; SQS visibility is 300s, and RDS start polling runs in the background so it doesn't trigger redelivery.
- **`scale` operation**: independent of `turn_on`/`turn_off` — never mutates the project's on/off `state.status` (no `markOn`/`markError`). `targets` (`{stepKey, replicas?|desiredCount?}[]`) are persisted on the job record itself so restart recovery has something to reconstruct from. A worker-side status recheck at the start of the branch narrows (doesn't eliminate) the race against a concurrent `turn_off`. See [ADR-017](../docs/decisions/ADR-017-demo-scale-job-operation.md) for the full design and its accepted limitations (notably: `argocd-app` scaling permanently collapses the HPA's autoscaling range to a single value — not recoverable through this tool).
- **ArgoCD namespace is per-call, not per-client**: `ArgocdClient.listWorkloads(app, namespace)` takes `namespace` as an argument — it is not baked into the client at construction. Each project's `argocd-app` resource carries its own `workload_selector.namespace`, and `ArgocdController`/`job-runner.ts` thread that value through on every `turnOff`/`turnOn`/`scale` call, since one worker-wide `ArgocdClient` instance serves every project's ArgoCD applications regardless of which K8s namespace each lives in.

### Tests
- Unit: vitest + `aws-sdk-client-mock` / fetch mocks.
- Integration: LocalStack (DynamoDB/SQS/STS/Secrets) via `docker-compose.yaml`.
- CI: `.github/workflows/backend-ci.yml` (lint/typecheck/test on PR, LocalStack service container).

## frontend/ — Stage 3 (MVP, dev only)
Next.js 14 (App Router) + TypeScript. Dashboard with stat strip, faceted sidebar
(category/account/status), search, project cards with working on/off toggles +
job polling, a detail drawer (resources, GitHub repo link, briefing, history),
a bulk "turn on all" action, and per-resource demo-scale controls. Talks to the
backend via same-origin `/api/*` (dev: `next.config.mjs` rewrites to the
dev-server on :8087; prod: same CloudFront origin as `api`). Backed in dev by
`backend/packages/api/src/dev-server.ts` (real API, in-memory state, simulated
worker). Full details in `frontend/CLAUDE.md`.
Not yet: real-time updates (SSE/WebSocket instead of poll-on-toggle), ECS deploy.

## Conventions
The intent is to keep both sides strictly typed and share the Node16 ESM import convention (`.js` extensions) across the boundary. All cross-account operations belong in the backend, which assumes `DemoPlatformOperator` per `accounts.yaml` — the frontend has no AWS SDK dependency and never handles that layer directly. AWS credentials likewise stay out of the frontend entirely: the backend runs as `DashboardEcsTaskRole-dev`, does its STS AssumeRole into `DemoPlatformOperator` there, and doesn't persist the resulting tokens.
