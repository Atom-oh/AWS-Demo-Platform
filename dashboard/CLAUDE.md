# Dashboard

The dashboard has a Fastify API, SQS worker and Next.js frontend. Dev ECS Fargate
definitions and image workflows exist; repository code does not establish the
running revision. See the [root guide](../CLAUDE.md) for infrastructure conventions
and the [frontend guide](frontend/CLAUDE.md) for UI behavior.

## Backend ownership

| Package (`backend/packages/`) | Responsibility |
| --- | --- |
| `shared` | Zod schemas, `stepKey`, AWS/ArgoCD/GitHub clients, role cache and DynamoDB state/jobs/history |
| `api` | Auth, configured project metadata, lifecycle/scale validation, job creation and enqueue |
| `worker` | SQS polling, startup recovery, ECS/EC2/RDS/ArgoCD controllers and GitHub discovery |

The API loads schema-valid project YAML at boot and seeds missing state rows as
`on`; invalid project documents are logged and skipped. State is bookkeeping, not
a resource health probe. The worker separately loads projects/accounts at boot.
Its immediate/hourly GitHub discovery writes `meta#discoverable` to DynamoDB;
the API/UI do not consume that snapshot or automatically onboard those repositories.

AWS controllers assume the account's configured operator role with its ExternalId.
One worker-wide ArgoCD client uses `ARGOCD_BASE_URL`; each call supplies the
resource's `workload_selector.namespace`. The `cluster` field does not select
another ArgoCD endpoint. See [ADR-002](../docs/decisions/ADR-002-argocd-control-via-rest-api.md).

## Contracts to preserve

- The browser sends a Cognito **access token**. The verifier reads its `username`
  claim, maps it to the plugin's internal `cognito:username` field, then checks
  `ADMIN_USERNAMES`. The API entry point bypasses JWT only for literal
  `NODE_ENV=development`; deployed dev tasks use `production`.
  [ADR-005](../docs/decisions/ADR-005-cognito-spa-auth-code-pkce.md) owns auth details.
- Lifecycle requests conditionally enter `transitioning`, create a job, enqueue
  and return `202 {job_id}`. Off requires `on`; on accepts `off` or `error`.
  These writes are not transactional. Recovery is best-effort replay, without a
  completed-job guard or progress-based skipping.
- Off saves restoration data by resource `stepKey` after controller work. Even
  partial off marks the project `off`; partial on uses `markError` to preserve
  saved data. Missing restoration entries are skipped and can still yield `on`.
  RDS availability polling is detached; job success does not mean readiness.
  [ADR-001](../docs/decisions/ADR-001-sqs-worker-for-async-jobs.md) records recovery,
  persistence and history limitations.
- ArgoCD off pins HPA min/max and workload replicas to 1. Scale accepts ECS
  `desiredCount` or ArgoCD `replicas` in 1–20, checks `on` in API and worker,
  persists targets and never changes project status. Backend checks do not
  serialize scale against off or another scale.
- HPA baselines are write-once, but persistence follows successful controller
  return. An HPA patch can succeed before a sibling fails, leaving no original
  baseline. Verify a failed first scale **before the next off**; otherwise off
  can preserve already-pinned bounds. See
  [ADR-017](../docs/decisions/ADR-017-demo-scale-job-operation.md) for persistence,
  concurrent writes and ArgoCD sync exposure.

## Frontend operations

The [frontend](frontend/CLAUDE.md) defaults to a sortable project table, with an
optional card view, detail drawer and confirmed bulk on/off for selected eligible
rows. `useOperations` coordinates up to four active client attempts and one per
project, including scale; a running batch blocks manual mutations. Its queue,
results and locks survive dashboard refresh or drawer/view changes while mounted,
but are not restored after a browser reload. Accepted backend jobs can outlive
client polling. These UI guards do not add backend serialization or durable batch
recovery. The result panel tracks the latest batch, not all server jobs.

## Development and verification

From `dashboard/backend`, install with `pnpm install`; run `pnpm -r build`,
`pnpm -r lint` and `pnpm -r test`. Workspace builds use `tsc -b`; Vitest does not
typecheck. `pnpm typecheck` builds shared first, then runs workspace `tsc --noEmit`.
Backend Node16 ESM relative imports require `.js`.

Integration tests need LocalStack on port 4566: `pnpm stack:up`;
`pnpm stack:down` also removes its local volumes. Tests cover route validation,
controller calls, partial outcomes and recovery payloads; mocks are not proof of
crash-safe restoration or AWS readiness.

[Backend CI](../.github/workflows/backend-ci.yml) runs typecheck/lint/tests with
LocalStack, then builds/pushes API and worker images on matching main changes.
It bundles root `projects/` and `accounts.yaml` into generated `backend/_config`;
Dockerfiles consume that bundle. Project/account-only edits do not match the
workflow filters. [ADR-003](../docs/decisions/ADR-003-gha-oidc-ecr-push.md) and
[ADR-006](../docs/decisions/ADR-006-arm64-graviton-native-build.md) cover publication
and ARM64 requirements. ECS rollout is a separate explicit operation.
