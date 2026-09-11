<!-- generated-by: co-agent · source: CLAUDE.md · claude-md-sha: 163866638b88 · generated-at: 2026-09-11 · DO NOT EDIT — edit CLAUDE.md then run /co-agent sync-context -->
> You are an external reviewer for this repo — project context below, distilled from CLAUDE.md. This file is shared verbatim by Kiro, Codex, and Agy (not a per-AI copy).

# AWS Demo Platform — reviewer context

Admin platform for GitHub-linked AWS demo projects across accounts. Non-production:
brief outages, small replicas and relaxed HA are deliberate, not defects.

## Source of truth

Root `CLAUDE.md` is the canonical guide; read the nearest module `CLAUDE.md` for
local details. `docs/architecture.md` maps implemented boundaries and ownership;
`docs/runbooks/` defines operations. Historical specs and ADR observations are not
live deployment status. Update CLAUDE.md first, then regenerate this marked file
with `/co-agent:sync-context`; validate its source hash, size and absence of secrets.
Kiro's steering bridge points here rather than maintaining another context copy.

## Stack and verification

- Backend: Node 20, strict TypeScript, pnpm `shared` / `api` / `worker`; Fastify and
  SQS. Backend Node16 ESM relative imports need `.js`. Frontend: Next.js 14 App Router,
  React 18, strict TypeScript with bundler resolution and its existing aliases.
- ECS Fargate tasks/images stay ARM64 (`linux/arm64`) in `ap-northeast-2`.
  The EKS hub `mall-apne2-mgmt` hosts GitOps/automation/observability/runners, not the
  ECS dashboard. Spokes are `mall-apne2-az-a` and `mall-apne2-az-c`. Some
  `k8s/system` overlays target those spokes; use the owning Application destination.
- Terraform 1.9.6 is pinned in Atlantis. Shared S3 backend
  `multi-region-mall-terraform-state`, unique key per root module, DynamoDB locking
  via `multi-region-mall-terraform-locks`; no TF 1.10+ `use_lockfile` syntax.
- Backend: `pnpm -r build`, then `pnpm -r lint` and `pnpm -r test` from
  `dashboard/backend`. `tsc -b` is the actual compilation gate; vitest/esbuild do not
  check types. Integration tests need LocalStack on port 4566.
- Frontend: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` from
  `dashboard/frontend`. Harness: `bash tests/run-all.sh`; Grafana checks need
  kubectl/PyYAML, so inspect skips.
- Terraform: init/format/validate per module and review an actual plan before apply.
  Kubernetes: local Kustomize render, then suitable dry-run with correct context,
  credentials and already-created prerequisites. CI success is not live validation.

## Invariants a diff must preserve

- Public ingress is CloudFront → VPC Origin → internal ALB → target IPs. The ALB
  HTTPS SG accepts exactly the CloudFront VPC Origin source SG plus `10.0.0.0/8`,
  not `172.16.0.0/12` or `192.168.0.0/16`. Kubernetes uses TargetGroupBinding for
  Pod-IP registration from Services; it is not a traffic hop. No public Grafana NLB
  or Kubernetes Ingress. ADR-007 permits private observability NLB fan-in only.
- Reuse the existing `*.atomai.click` wildcard ACM cert through a data lookup.
  HTTPS origin names must match its SANs. Dashboard `/api/*` uses
  `AllViewerExceptHostHeader` plus `CachingDisabled`; Host reaches the correct API
  origin and Authorization is not cached. Grafana keeps AllViewer and disabled caching.
- Cross-account operations assume configured `OperatorRole`,
  `DemoPlatformTerraformer` or `DemoPlatformOperator` with an ExternalId from
  `/demo-platform/external-ids/<account>/<role>`; never ambient fallback to another
  account. The application's `DashboardEcsTaskRole` performs backend assume-role;
  the frontend never holds AWS credentials.
- The browser sends a Cognito access token, not an ID token. API bootstrap permits
  `skipJwt` only for literal `NODE_ENV === 'development'`; all other values,
  including unset, enforce JWT auth. Verified `cognito:username` must be in
  `ADMIN_USERNAMES`. Deployed dev tasks still use `NODE_ENV=production`; the deployment stage is not
  an auth bypass. A frontend development auth flag does not relax the API.
- Backend/frontend image publication uses `demo-platform-gha-ecr-push` via GitHub
  OIDC trust scoped to this repo's main branch. `id-token: write` belongs to the
  image-push jobs, not lint/test jobs. Preserve Atlantis's `--write-git-creds`.
- Verify the selected kube context resolves to the intended cluster/account and
  pass `--context`; the default can be another cluster. Existing instance-profile
  credentials may be hidden by sandbox metadata/network restrictions. Verify STS
  identity/access before replacing credentials; never print credential values.
- Terraform resource names use `demo-platform-`; secret paths use `/demo-platform/...`.
  Repository docs and code comments are English-only; missing Korean duplicates
  are not defects. Operator conversation can be Korean.

## Backend and deployment boundaries

`shared` owns schemas/clients, `api` validates requests/state and enqueues, and
`worker` performs resource operations. Lifecycle actions transition to
`transitioning`, persist a job and return 202. Work is idempotent, running jobs
resume after restart, and the queue uses a three-receive redrive policy (ADR-001).

`turn_off` captures restoration data by a resource-unique `stepKey`; failed
`turn_on` must preserve it via `markError`. Kubernetes off pins HPA min/max and
workload replicas to 1, not zero; on restores captured values. ArgoCD calls use REST,
with workload namespace per call (ADR-002). Cluster metadata alone does not select
another ArgoCD API endpoint.

`scale` requires project status `on`; the worker rechecks it and never mutates
that status. Targets persist with the job. HPA scaling pins its range, but a write-once first-observed baseline must survive
repeated scales so a later off/on cycle can restore it. Respect ADR-017's accepted
races/partial failures rather than treating every non-production trade-off as a bug.

Image CI builds/pushes but does not roll ECS services. Services ignore
`task_definition`/`desired_count`; use an explicitly selected revision and verify
running tasks/counts. A Terraform worker default of zero is not a live status.
Project/account configuration is already bundled into images; project/account-only
changes do not match current backend CI filters, so require an explicit build/rollout.

`infra/eks-mgmt` owns the hub state at
`production/ap-northeast-2/eks-mgmt/terraform.tfstate`. Dependencies must apply before
new remote-state outputs can be planned by consumers. Project metadata must match
the current schema and actual workload owner; not every project requires an ArgoCD
root, and unsupported drafts are not implemented capabilities.

## Grafana ownership and credential readiness

This repo owns Grafana's private ALB route, shared VPC Origin, target group and
Kubernetes binding. `Atom-oh/multi-region-architecture` owns its CloudFront
and public DNS in Korea `shared/`. Never import a resource into both states.

Secrets Manager `/demo-platform/grafana/admin` supplies ESO
`monitoring/grafana-admin`, consumed by Grafana and both sidecars. The persisted
database password does not rotate when a Secret changes, and existing containers
do not reload their environment automatically. Verify the managed database
credential, ESO Ready and value agreement, then roll the consumers. For a new
producer/consumer change, deploy/verify the producer before a separate consumer
rollout. Keep values out of Git/Terraform state. A consumer revert is not a password
rollback; retain the known managed value. See ADR-018 and the Grafana runbook.

## Review and release expectations

AI review is supplemental. Distinguish model execution, meaningful coverage and
verified findings. Match results to the current head and inspect actual branch
rules; do not assume a workflow is enforced. Model/config/quota failures must stay
visible, not be silently relabeled PASS or worked around by weakening CI/budget limits.
The gate-hardening spec remains a proposal where its safeguards are not implemented.

Before removal/cutover, inspect live consumers across repositories/states and the
actual plan. Deploy and health-check the replacement, cut over, verify public TLS,
login and data access, then retire the old resource. ArgoCD Healthy, a successful
apply and an AI PASS are different signals. Authorized incident exceptions need
recorded scope, independent review and runtime evidence; targeted plans prove only
their selected scope. See `docs/runbooks/review-and-release.md`.

## Known non-issues

The commit hook removes `Co-Authored-By`. Immutable task-definition replacement is
normal; ECS service destruction is a different risk. Visibility-only resource types
intentionally have no toggle controller. The internal observability NLB exception
does not permit a public Grafana fallback.
