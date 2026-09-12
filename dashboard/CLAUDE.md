# dashboard/ Module

## Role
Stage 2–3 admin platform for AWS Demo Platform.
- **`backend/`** — Implemented **Lifecycle Controller**. Node.js TypeScript pnpm-workspaces monorepo with dev ECS runtime definitions; verify running revisions separately.
- **`frontend/`** — Stage 3 admin UI (Next.js 14, App Router). **MVP built (dev only):** live project list, faceted discovery, on/off toggles, detail drawer (resources, GitHub link, briefing, history), confirmed bulk start of visible projects, and per-resource demo-scale controls — via same-origin `/api/*` proxy. See `frontend/CLAUDE.md`.

## backend/ — Lifecycle Controller (implemented)

pnpm workspaces monorepo. Three packages:

| Package | Role |
|---|---|
| `@demo-platform/shared` | Zod schemas (project/account/DDB records), `stepKey` + `MAX_SCALE_REPLICAS`, pino logger, env loaders, AWS SDK client factory, AssumeRole cache (TTL skew), DDB clients (state/jobs/history), ArgoCD REST client, GitHub client |
| `@demo-platform/api` | Fastify REST API: `/health`, `/api/projects`, `/api/projects/*`, `.../actions/{turn_on,turn_off,scale}`, `/api/jobs/:id`. Cognito JWT plugin (skip in `NODE_ENV=development`), projects-loader, error handler |
| `@demo-platform/worker` | SQS consumer + startup sweep, 4 resource controllers (ECS/EC2/RDS/ArgoCD HPA-2) plus `scale` support (`EcsController.setDesiredCount`, `ArgocdController.scale`), runJob dispatcher, GitHub discoverer (hourly cron) |

### Commands (run from `dashboard/backend/`)

Install dependencies with `pnpm install`. Run `pnpm -r build` first, then `pnpm -r lint` and `pnpm -r test`. `pnpm typecheck` first builds `shared`, then runs workspace `tsc --noEmit`; `pnpm build` compiles via `tsc -b` into `dist/`. Vitest integration tests need LocalStack on `:4566` (`pnpm stack:up`). `pnpm stack:down` also deletes its local volumes.

Docker images build per-package. From `dashboard/backend`, prepare a fresh generated
`_config` bundle as `backend-ci.yml` does: remove the old generated bundle, create
`_config`, copy `../../projects` to `_config/projects`, and copy
`../../accounts.yaml` to `_config/accounts.yaml`. Do not keep hand-written files in
that generated directory. Then use
`docker build --platform=linux/arm64 -f packages/api/Dockerfile -t demo-platform-api:dev .`
or
`docker build --platform=linux/arm64 -f packages/worker/Dockerfile -t demo-platform-worker:dev .`.
Release builds use the native ARM64 runner. Project/account-only changes do not
trigger current backend CI filters; arrange the build and service rollout explicitly.

### Non-obvious patterns
- **Node16 ESM**: relative imports rely on `.js` extensions to resolve; `tsc -b` is the real typecheck gate, since vitest and esbuild both skip type errors.
- **AssumeRole flow**: the worker assumes `DemoPlatformOperator` per `accounts.yaml`, using the ExternalId stored in Secrets Manager; creds are cached with TTL skew.
- **HPA-2 (ArgoCD controller)**: the goal of `turn_off` is a scaled-down state that ArgoCD won't fight, so it patches HPA `min=max=1` plus Deployment/StatefulSet `replicas=1` rather than a true zero.
- **turn_on restores resources**: `worker/src/job-runner.ts` reads `restoration_data` off the DDB state record and dispatches per-resource into each controller's `turnOn(rd)` (ECS desiredCount / EC2 start / RDS start / ArgoCD HPA-2 restore). RDS `waitForAvailable` is fire-and-forget. Restoration keys each entry by a **unique per-resource `stepKey`** (e.g. `argocd-app:<application>`) so that same-type resources don't collide. A partial `turn_on` failure calls `markError`, which preserves `restoration_data` for retry, instead of `markOn`.
- **Job model**: the api enqueues to SQS and the worker processes idempotently; SQS visibility is 300s, and RDS start polling runs in the background so it doesn't trigger redelivery.
- **`scale` operation**: independent of `turn_on`/`turn_off` — never mutates the project's on/off `state.status` (no `markOn`/`markError`). `targets` (`{stepKey, replicas?|desiredCount?}[]`) are persisted on the job record itself so restart recovery has something to reconstruct from. A worker-side status recheck at the start of the branch narrows (doesn't eliminate) the race against a concurrent `turn_off`. See [ADR-017](../docs/decisions/ADR-017-demo-scale-job-operation.md) for the full design and its accepted limitations.
- **ArgoCD namespace is per-call, not per-client**: `ArgocdClient.listWorkloads(app, namespace)` takes `namespace` as an argument — it is not baked into the client at construction. Each project's `argocd-app` resource carries its own `workload_selector.namespace`, and `ArgocdController`/`job-runner.ts` thread that value through on every `turnOff`/`turnOn`/`scale` call, since one worker-wide `ArgocdClient` instance serves every project's ArgoCD applications regardless of which K8s namespace each lives in.
- **HPA baseline preservation**: `scale()` pins an HPA's `min=max` to the requested count, which would otherwise permanently erase its original autoscaling range. `StateClient.recordHpaBaselineIfAbsent`/`readHpaBaseline` persist the *first-ever-observed* bounds for a given `argocd-app` resource as a write-once sibling DDB item (`sk=hpa-baseline#<stepKey>`, conditional `attribute_not_exists(pk)`) — both `ArgocdController.scale()` (via `getLive` before patching) and `job-runner.ts`'s `turnOffOne` (record-then-read, preferring the baseline over its own freshly-observed live bounds) can be the one that captures it first. A `turn_off`→`turn_on` cycle now restores the true original range even after any number of prior `scale` calls.

### Tests
- Unit: vitest + `aws-sdk-client-mock` / fetch mocks.
- Integration: LocalStack (DynamoDB/SQS/STS/Secrets) via `docker-compose.yaml`.
- CI: `.github/workflows/backend-ci.yml` (lint/typecheck/test on PR, LocalStack service container).

## frontend/ — Stage 3 (MVP, dev only)
Next.js 14 (App Router) + TypeScript. Dashboard with stat strip, faceted sidebar
(category/account/status), search, project cards with working on/off toggles +
job polling, a detail drawer (resources, GitHub repo link, briefing, history),
a confirmed bulk start scoped to visible projects, and per-resource demo-scale controls. Talks to the
backend via same-origin `/api/*` (local dev: `next.config.mjs` rewrites to the
dev-server on :8087; deployed routing: one CloudFront distribution with separate
frontend/API origins). Local development is backed by
`backend/packages/api/src/dev-server.ts` (real API, in-memory state, simulated
worker). Full details in `frontend/CLAUDE.md`.
Real-time push updates remain a follow-up. ECS service/CloudFront definitions and
image publication already exist; a new image still needs an explicit ECS rollout.

## Conventions
Keep both sides strictly typed. Backend Node16 ESM relative imports need `.js`; the frontend uses Next.js/bundler resolution and `@/` aliases. All cross-account operations belong in the backend, which assumes `DemoPlatformOperator` per `accounts.yaml` with an ExternalId. The frontend has no AWS SDK dependency or AWS credentials; it sends the Cognito access token to the API. The API's runtime JWT bypass is restricted to the literal development environment and verified usernames must be in `ADMIN_USERNAMES`.
