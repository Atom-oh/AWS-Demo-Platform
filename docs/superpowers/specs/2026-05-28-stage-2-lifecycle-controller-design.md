# Stage 2 lifecycle controller — original design

**Date:** 2026-05-28. **Original status:** approved, pending implementation.
**Scope at adoption:** dev environment and `atomoh-main`; frontend and friend-account
expansion were later stages. **Reconciled:** 2026-09-13 against repository source,
not live deployment. Full schemas, pseudocode and task checklists remain in Git history.

## Intent and decisions

Build the asynchronous backend needed by the dashboard: validate authenticated
requests, persist jobs/state/history, and control ECS, EC2, RDS and ArgoCD workloads
without keeping HTTP requests open. This narrowed the
[May platform design](2026-05-26-aws-demo-platform-design.md) into an implementable
backend increment.

| Choice | Rationale |
| --- | --- |
| Separate API and SQS worker on Fargate | Keep request latency independent of resource operations; retain queued work across task restarts |
| Fastify and pnpm `shared`/`api`/`worker` workspaces | Keep schemas/clients shared and HTTP handlers separate from controllers |
| Cognito from Stage 2 | Prepare server authorization before the frontend arrived |
| ArgoCD REST and one admin token | Avoid direct per-cluster Kubernetes credential/RBAC plumbing |
| Four controllers, including RDS | Deliver complete compute lifecycle coverage within the selected account |
| Immediate/hourly discovery in the worker | Avoid a separate scheduling service |
| LocalStack and mocked controller tests | Verify contracts locally while reserving actual AWS readiness for live validation |

The planned delivery order was backend foundations and state/IAM/queue resources
in parallel, ECR creation before image publication, then runtime/routing/Cognito
and a controlled live toggle. Configuration slots required separate credential
population. Those dependencies remain useful; old task counts and placeholder
resource identifiers do not.

## Current applicability

The three workspace packages, controllers, queue, DynamoDB clients, discovery and
API routes exist. [Dashboard context](../../../dashboard/CLAUDE.md) owns current
commands and package boundaries. Important corrections to the original design:

- API and worker load configuration at startup; there is no signal-driven reload.
  Invalid project YAML is logged and skipped. Images bundle the configuration,
  but metadata-only changes do not trigger backend image CI.
- The lifecycle API conditionally enters `transitioning`, creates a job and
  enqueues; these operations are not one transaction. On accepts `off` or `error`.
  Partial off still records `off`; partial on preserves restoration through
  `markError`. Missing restoration can be skipped without a controller call.
- The worker does not first read a job to reject duplicates or skip completed
  progress. Its startup sweep uses an unpaginated scan of `running` jobs with no
  time bound, not the proposed age-filtered query. Pending orphan repair is absent.
- RDS polling is detached and logs failures; it does not continue updating a
  completed job. Jobs and project status do not establish resource readiness.
  [ADR-001](../../decisions/ADR-001-sqs-worker-for-async-jobs.md) owns these limits.
- History is appended per completed worker outcome, not per resource step;
  worker history currently records actor `system`. Resource failures are handled
  inside the job, rather than universally retried according to error class.
- [ADR-002](../../decisions/ADR-002-argocd-control-via-rest-api.md) uses resource GETs
  and POST patches with namespace supplied per call. Off and on patch HPA bounds
  before workload replicas. Baseline capture and later scale are governed by
  [ADR-017](../../decisions/ADR-017-demo-scale-job-operation.md).
- The verified access token supplies `username`, mapped to the plugin's internal
  `cognito:username`. API bypass is literal `NODE_ENV=development`; deployed dev
  tasks use `production`. See
  [ADR-005](../../decisions/ADR-005-cognito-spa-auth-code-pkce.md).
- ECR uses separate API/worker repositories, later joined by frontend. All three
  ECS images are ARM64. CI publishes images; the proposed automatic ECS update
  steps were not implemented. [ADR-003](../../decisions/ADR-003-gha-oidc-ecr-push.md)
  and [ADR-006](../../decisions/ADR-006-arm64-graviton-native-build.md) own those decisions.

Secret-management APIs/UI, automatic demo health checks, multi-user RBAC and
notifications were outside this increment and are not implied by schema fields
or IAM permissions. The old monthly cost table and completion checklist were
estimates/acceptance targets, not evidence of billing or running task counts.

## Evidence and verification boundary

[Backend CI](../../../.github/workflows/backend-ci.yml) runs typecheck, lint and
tests with LocalStack. [Runner tests](../../../dashboard/backend/packages/worker/src/__tests__/job-runner.test.ts)
and [poll-loop tests](../../../dashboard/backend/packages/worker/src/__tests__/poll-loop.test.ts)
cover dispatch, partial outcomes and recovery payloads. Their mocks do not prove
atomic restoration, a deployed assume-role chain or public login/data access.
Use the [release runbook](../../runbooks/review-and-release.md) for runtime validation.
