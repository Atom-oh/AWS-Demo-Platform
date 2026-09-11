# Project Context

## Overview

AWS Demo Platform manages GitHub-linked AWS demo projects across accounts: project
and resource discovery, lifecycle toggles, demo preparation, URLs and scoped AWS
operations. This is a non-production platform; brief outages and deliberately
small replicas or single-AZ deployments are accepted trade-offs.

The dashboard backend and frontend are implemented in this repository. Terraform
defines their dev ECS Fargate runtime. The EKS hub hosts GitOps, Terraform automation,
observability and CI runners; it does not host the ECS dashboard services.
`main` targets dev; semver tags express the production release convention. The
current image workflows run on matching main changes, not an automatic tag-to-prod
deployment. Code present on
main, an image pushed to ECR and a running service revision are distinct states.
Verify runtime health and deployed revisions before claiming a feature is live.

This file is the canonical repository guide. Read the nearest module `CLAUDE.md`
for local details. Root `AGENTS.md` is a generated, concise reviewer summary of this
file; update this source first, then run `/co-agent:sync-context`. The Kiro steering
bridge references that same `AGENTS.md`. [Documentation map](docs/README.md) explains
the roles of current guides, ADRs, runbooks and historical plans.

## Tech Stack

- **Infrastructure:** Terraform 1.9.6, pinned by `atlantis.yaml`; AWS provider;
  shared S3 backend `multi-region-mall-terraform-state`, a unique key per module,
  and DynamoDB locking through `multi-region-mall-terraform-locks`. Preserve the
  pin and `dynamodb_table`; do not introduce TF 1.10+ `use_lockfile` syntax.
- **Backend:** Node 20, strict TypeScript, pnpm workspaces `shared` / `api` / `worker`.
  Fastify serves the API; SQS drives resource controllers. Backend Node16 ESM
  relative imports require `.js` extensions.
- **Frontend:** Next.js 14 App Router, React 18, strict TypeScript with bundler
  resolution. Cognito Authorization Code + PKCE; same-origin `/api/*` requests.
- **Compute:** ECS Fargate ARM64/Graviton in `ap-northeast-2`. The hub is
  `mall-apne2-mgmt`; tenant spokes are `mall-apne2-az-a` and `mall-apne2-az-c`.
- **GitOps and automation:** ArgoCD App-of-Apps and Atlantis using GitHub App
  `atomoh-atlantis`. Repository manifests use Kustomize; upstream components use
  Helm. Version declarations in the manifests are the source of truth.
- **Secrets:** AWS Secrets Manager and External Secrets Operator (ESO), using
  `external-secrets.io/v1` and `ClusterSecretStore aws-secrets-manager`.
- **Observability:** hub Prometheus/Grafana, ClickHouse and Tempo. ADR-007 permits
  internal observability NLBs for spoke-to-hub fan-in, not public Grafana ingress.
- **AI review:** `.github/workflows/pr-review.yml` and `scripts/pr-review/` configure
  four panel slots (Codex, two Kiro slots, Claude self-review) over lenses L2–L5
  and a chair. Consult the scripts and runner configuration for model IDs;
  configured slots and successful jobs do not prove successful model responses.

## Project Structure

| Path | Responsibility |
| --- | --- |
| `accounts.yaml`, `projects/` | Account roles and schema-validated project metadata |
| `dashboard/backend/` | Shared schemas/clients, API and asynchronous worker |
| `dashboard/frontend/` | Discovery, detail drawer, toggles, briefing and demo-scale UI |
| `infra/` | Independently stateful Terraform modules; read each module guide |
| `k8s/system/` | Hub components and explicitly targeted spoke infrastructure overlays |
| `argocd-apps/` | Bootstrap roots, system Applications/ApplicationSets and tenant roots |
| `scripts/`, `tests/` | Setup, review orchestration and local harness checks |
| `docs/` | Architecture, decisions, operations and historical design records |

`infra/eks-mgmt` is the owner of the hub cluster state. Its state key remains
`production/ap-northeast-2/eks-mgmt/terraform.tfstate`; the duplicate module was
removed from `multi-region-architecture`. That repository retains ownership of
the Grafana CloudFront distribution and public DNS in
`terraform/environments/production/ap-northeast-2/shared`. This repository owns
Grafana's internal ALB route, shared VPC Origin, target group and Kubernetes
binding. Never manage the same resource from both states.

## Conventions

- **Public ingress:** CloudFront → VPC Origin → internal ALB → target IPs.
  The ALB HTTPS SG accepts exactly the CloudFront VPC Origin source SG plus
  `10.0.0.0/8`, not the broader RFC1918 ranges. For Kubernetes, TargetGroupBinding
  registers Pod IPs from a Service; it is a control-plane relationship, not an
  extra traffic hop. Do not add a Kubernetes Ingress or public Grafana NLB.
- **Certificates and routing:** reuse the existing `*.atomai.click` ACM certificate
  through a data lookup. HTTPS origin hostnames must match its SANs. Dashboard
  `/api/*` routing uses `AllViewerExceptHostHeader` and `CachingDisabled`, keeping
  the origin Host correct and Authorization uncached. Grafana retains AllViewer
  and disabled caching for its two aliases.
- **Cross-account access:** use the configured `OperatorRole`,
  `DemoPlatformTerraformer` or `DemoPlatformOperator` with an ExternalId from
  `/demo-platform/external-ids/<account>/<role>`. Never fall back to ambient
  credentials for another account. The backend's `DashboardEcsTaskRole` performs
  the application assume-role calls; the frontend never holds AWS credentials.
- **Application auth:** the frontend sends the Cognito access token, not the ID
  token. The API entry point permits JWT bypass only for the literal
  `NODE_ENV === 'development'`; any other value, including unset, enforces auth.
  The verified access token's `cognito:username` must be in `ADMIN_USERNAMES`.
  Deployed dev tasks still set `NODE_ENV=production`; the deployment stage is not
  a JWT bypass. A frontend development auth flag does not relax that server policy.
- **CI identity and images:** GitHub OIDC trust is scoped to this repository's main
  branch for `demo-platform-gha-ecr-push`; in backend/frontend CI, `id-token: write` belongs only to the image-push jobs,
  not lint/test jobs. Match `linux/arm64` images with ECS `cpu_architecture = ARM64`.
- **Kubernetes identity:** verify that the explicitly selected kube context resolves
  to the intended cluster/account before cluster operations. Pass `--context`;
  the shell's default context may point at another cluster.
- **Operator credentials:** an existing instance profile can supply same-account
  credentials. Verify `aws sts get-caller-identity`. A sandbox can block metadata
  access and produce `NoCredentials`; check the permitted network path before
  replacing credentials or requesting a new login. Do not print secret values.
- **Naming and language:** Terraform resource names use `demo-platform-`; secret
  paths use `/demo-platform/...`. Repository docs and code comments are English-only;
  operator conversation may be Korean. Missing Korean duplicates are not defects.
- **Atlantis:** preserve `--write-git-creds` for GitHub App authentication.

## Architectural Boundaries

`shared` owns schemas and DDB, AWS, GitHub and ArgoCD clients. `api` validates
requests/state and enqueues work; `worker` performs ECS, EC2, RDS and ArgoCD resource
operations. The lifecycle API transitions to `transitioning`, creates a job and
returns 202. Worker processing is idempotent, resumes running jobs after restart,
and uses the queue's three-receive redrive policy.

`turn_off` stores restoration data under a resource-unique `stepKey`. A failed
`turn_on` must preserve that data through `markError`. For Kubernetes, off means
HPA `min=max=1` plus workload replicas 1, not zero; on restores the captured bounds.
The shared ArgoCD client receives workload namespaces per call and controls resources
through ArgoCD REST, not direct Kubernetes calls from the backend. The worker uses
one configured ArgoCD base URL; cluster metadata alone does not connect an
independent ArgoCD installation.

`scale` is a separate asynchronous operation: the API requires project status `on`,
the worker rechecks it, and the operation never changes that status. Targets are
persisted on the job for restart recovery. HPA scaling pins
min/max; the first observed original bounds are stored as a write-once DDB baseline
so a later off/on cycle can restore them. Preserve this baseline across repeated
scales. See [ADR-001](docs/decisions/ADR-001-sqs-worker-for-async-jobs.md),
[ADR-002](docs/decisions/ADR-002-argocd-control-via-rest-api.md) and
[ADR-017](docs/decisions/ADR-017-demo-scale-job-operation.md).

ECS services ignore `task_definition` and `desired_count` drift in Terraform.
Image CI builds and pushes; it does not roll the services. Deploy with an explicitly
selected task-definition revision and verify the running revision/count. The worker's
Terraform initial count of zero is not a statement of its current runtime state;
CI already bundles its project/account configuration. Project/account-only edits
do not match the current backend CI path filters, so arrange an image build and
explicit rollout rather than assuming a merge refreshes the runtime metadata.

Grafana's credential lives in `/demo-platform/grafana/admin` and is synchronized to
`monitoring/grafana-admin`. The Helm chart and both sidecars consume that Secret.
A Secret update does not change the persisted Grafana database password or restart
existing containers. Rotate and verify the database credential, wait for ESO Ready
and value agreement, then roll the consumers. For a new producer/consumer migration,
land the producer first and gate a separate consumer change on readiness. Keep
credential values out of Git and Terraform state. See
[ADR-018](docs/decisions/ADR-018-grafana-private-origin.md) and the
[Grafana runbook](docs/runbooks/grafana-private-ingress.md).

## Key Commands

| Scope | Verification |
| --- | --- |
| Backend (`dashboard/backend`) | `pnpm -r build`, then `pnpm -r lint` and `pnpm -r test` |
| Frontend (`dashboard/frontend`) | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` |
| Local harness | `bash tests/run-all.sh` |
| Terraform module | `terraform init -backend=false`, `terraform fmt -check`, `terraform validate`; review a real plan before apply |
| Kubernetes | `kubectl kustomize <dir>`; client/server dry-run with the correct context and credentials after prerequisites exist |

Backend `tsc -b` is the compilation/typecheck gate; vitest/esbuild alone do not
check types. `*.int.test.ts` needs LocalStack on port 4566 (`pnpm stack:up` from
`dashboard/backend`). Grafana harness checks need kubectl and Python PyYAML;
missing prerequisites can skip that check, so inspect skips. `scripts/setup.sh`
installs the repository's local hooks.

## Review and Release

Use [review and release](docs/runbooks/review-and-release.md) for the full sequence:
relevant deterministic checks → current-head findings and independent assessment →
reviewed plans and live dependency inventory → deploy/verify the replacement →
cut over → verify public behavior → remove obsolete resources.

An AI PASS, a green panel job, a successful apply and ArgoCD Healthy are different
signals. None substitutes for public login/data-access checks or dependencies in
another repository/state. Inspect current branch rules instead of assuming a
workflow is a required merge gate. Keep model/quota/configuration failures visible;
do not silently relabel them PASS or weaken CI/billing limits to ship a fix.
An incident exception must be authorized, scoped and recorded with its independent
review and runtime evidence. The recovered gate-hardening spec is a proposal,
not evidence that its safeguards have been implemented.

Terraform normally applies through Atlantis PR comments. Apply dependencies before
planning their remote-state consumers and before merging manifests that require the
new resource. ArgoCD auto-syncs Git changes. If the deployment tool itself is broken,
use a narrowly scoped, reviewed recovery plan and record the exception; a targeted
plan says nothing about unrelated shared-state drift.

## Auto-Sync Rules

Update this file and affected module guides when contracts change. Update
`docs/architecture.md` for topology, resource ownership or Terraform changes;
record new architectural decisions under the next unused ADR number. Keep runbooks
current with deployment order, rollback boundaries and validation.

New infrastructure/component directories need a module guide. New `k8s/system/`
components also need an Application/ApplicationSet under `argocd-apps/system/` so
ArgoCD discovers them. Project onboarding must match the project schema and its
actual ArgoCD owner; update tenant coverage and any special onboarding procedure.
Changes to `accounts.yaml` also update the friend-account guide.

After changing root `CLAUDE.md`, regenerate the marked root `AGENTS.md` with
`/co-agent:sync-context`. Distill rather than copy this file. Emit its source-hash
marker with the installed co-agent `check_ai_context.py`, then run the validator
(size, freshness and secret checks). Preserve hand-written overrides and the Kiro
bridge to `AGENTS.md`. Keep historical specs/ADRs dated; use forward links instead
of rewriting history as though a proposal were deployed.

Known review non-issues: the commit hook removes `Co-Authored-By`; immutable task
definitions can be replaced without replacing their ECS service; visibility-only
resource types intentionally have no toggle controller; the documented internal
observability NLB exception is not a public-ingress exception.
