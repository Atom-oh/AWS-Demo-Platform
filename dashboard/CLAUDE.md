# dashboard/ Module

## Role
Stage 2–3 admin platform for AWS Demo Platform.
- **`backend/`** — Stage 2 **Lifecycle Controller**. Node.js TypeScript pnpm-workspaces monorepo. Phase 1 code is built on branch `feat/stage-2-phase-1-backend-foundations` and **pending merge to `main` (PR #4)** — `main` still has empty placeholders until then.
- **`frontend/`** — Stage 3 admin UI (Next.js). Still an empty placeholder.

## backend/ — Lifecycle Controller (implemented)

pnpm workspaces monorepo. Three packages:

| Package | Role |
|---|---|
| `@demo-platform/shared` | Zod schemas (project/account/DDB records), pino logger, env loaders, AWS SDK client factory, AssumeRole cache (TTL skew), DDB clients (state/jobs/history), ArgoCD REST client, GitHub client |
| `@demo-platform/api` | Fastify REST API: `/health`, `/api/projects`, `/api/projects/*`, `.../actions/turn_{on,off}`, `/api/jobs/:id`. Cognito JWT plugin (skip in `NODE_ENV=development`), projects-loader, error handler |
| `@demo-platform/worker` | SQS consumer + startup sweep, 4 resource controllers (ECS/EC2/RDS/ArgoCD HPA-2), runJob dispatcher, GitHub discoverer (hourly cron) |

### Commands (run from `dashboard/backend/`)
```bash
pnpm install
pnpm test          # vitest — unit + LocalStack integration (needs stack up)
pnpm typecheck     # tsc --noEmit, all 3 packages
pnpm lint          # eslint
pnpm build         # tsc -b → dist/
pnpm stack:up      # docker compose up -d  (LocalStack :4566 for integration tests)
pnpm stack:down
```
Docker images: `docker build -f packages/{api,worker}/Dockerfile -t demo-platform-{api,worker}:dev .`

### Non-obvious patterns
- **Node16 ESM**: all relative imports need `.js` extensions; `tsc -b` is the real gate (vitest/esbuild skips type errors).
- **AssumeRole flow**: worker assumes `DemoPlatformOperator` per `accounts.yaml` with the ExternalId from Secrets Manager; creds cached with TTL skew.
- **HPA-2 (ArgoCD controller)**: turn_off patches HPA `min=max=1` + Deployment `replicas=1` (never true zero).
- **turn_on is a Phase-1 stub**: `worker/src/job-runner.ts::turnOnOne` marks state on but does NOT yet restore resources from `restoration_data` — deferred to Phase 5/E2E.
- **Job model**: api enqueues to SQS → worker processes (idempotent); SQS visibility 300s, RDS start polling runs in background to avoid redelivery.

### Tests
- Unit: vitest + `aws-sdk-client-mock` / fetch mocks.
- Integration: LocalStack (DynamoDB/SQS/STS/Secrets) via `docker-compose.yaml`.
- CI: `.github/workflows/backend-ci.yml` (lint/typecheck/test on PR, LocalStack service container).

## frontend/ — Stage 3 (not started)
Next.js + TypeScript, master-detail layout, Cognito hosted-UI login. Empty placeholder.

## Rules
- TypeScript strict on both sides; `.js` import extensions (Node16).
- No AWS SDK calls from the frontend — all cross-account ops go through the backend (assumes `DemoPlatformOperator` per `accounts.yaml`).
- Frontend never sees AWS credentials; backend runs as `DashboardEcsTaskRole-dev` → STS AssumeRole into `DemoPlatformOperator`, never persists tokens.
