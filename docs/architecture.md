# Architecture

## System Overview

AWS Demo Platform is a hub-spoke control plane for GitHub-linked AWS demo projects.
The EKS hub `mall-apne2-mgmt` hosts Atlantis, ArgoCD, ESO, observability and CI
runners. The dashboard API, worker and Next.js frontend are separate ECS Fargate
services. These components are implemented and have Terraform/manifests in this
repository; this document is not a live-health or deployed-image inventory.

Public requests reach CloudFront, a VPC Origin and the internal ALB before target
IPs. For Kubernetes, TargetGroupBinding discovers/registers Pod IPs through a
Service; requests do not pass through the binding object. ECS services register
their task IPs with their own target groups. No Kubernetes Ingress is needed.

See [CLAUDE.md](../CLAUDE.md) for repository rules and the
[documentation map](README.md) for current versus historical sources.

## Components and ownership

| Component | Responsibility and source |
| --- | --- |
| CloudFront / shared VPC Origin | Platform distributions and private origin in `infra/cloudfront` |
| Internal ALB | HTTPS listener, restricted SG and target groups in `infra/alb-internal` |
| Dashboard runtime | API, worker and frontend Fargate definitions in `infra/dashboard-ecs` |
| Cognito | Dashboard user pool, public SPA client and hosted UI in `infra/cognito` |
| API / worker | `dashboard/backend`: request validation, job orchestration and controllers |
| Frontend | `dashboard/frontend`: discovery, detail drawer, briefing, selected bulk on/off and scale |
| Hub EKS | Owned by `infra/eks-mgmt`, not a duplicate module in the workload repository |
| ArgoCD | `master-system-root` watches `argocd-apps/system/`; `master-tenants-root` watches tenant roots |
| Atlantis | PR plan/apply through GitHub App auth, `AtlantisIRSARole` and scoped assume-role |
| ESO | `ClusterSecretStore aws-secrets-manager`; syncs declared Atlantis, runner and Grafana ExternalSecrets |
| Observability | Prometheus/Grafana, ClickHouse and Tempo on the hub; internal fan-in NLBs under ADR-007 |

### Grafana boundary

This repository owns Grafana's shared VPC Origin, internal ALB listener rule at
priority 140, `demo-platform-grafana` IP target group on port 3000, and
`monitoring/grafana` TargetGroupBinding. The binding references the existing
`prometheus-mall-apne2-mgmt-grafana` ClusterIP Service.

`Atom-oh/multi-region-architecture` owns the Grafana CloudFront distribution and
public DNS under `terraform/environments/production/ap-northeast-2/shared`.
Both `grafana-kr.atomai.click` and `grafana.atomai.click` use that distribution.
Do not import it into this repository's Terraform state. Inspect both owners
before altering or removing an origin.

The dashboard bundle has 11 ConfigMaps. The hub provisions `prometheus`,
`clickhouse`, `tempo` and `cloudwatch-korea`; the nodepool dashboard uses
`prometheus`. The US comparison dashboard remains source-only until its regional
datasources exist. Grafana's administrator is managed through
`/demo-platform/grafana/admin` → ESO `monitoring/grafana-admin` → Helm consumers.
See [ADR-018](decisions/ADR-018-grafana-private-origin.md) and the
[Grafana runbook](runbooks/grafana-private-ingress.md).

## Request and control flow

```mermaid
flowchart TB
  Browser[Operator browser] --> CF[CloudFront distributions]
  Browser --> Cognito[Cognito hosted UI and PKCE]
  CF --> VO[Shared VPC Origin]
  VO --> ALB[Internal ALB HTTPS listener]
  ALB --> TG[Per-service IP target groups]

  subgraph ECS[ECS Fargate ARM64]
    FE[Next.js frontend]
    API[Fastify API]
    Worker[SQS worker]
  end
  subgraph Hub[EKS hub: mall-apne2-mgmt]
    Atlantis[Atlantis]
    ArgoCD[ArgoCD]
    Grafana[Grafana]
    LBC[AWS Load Balancer Controller]
    ESO[External Secrets Operator]
  end

  TG --> FE
  TG --> API
  TG --> Atlantis
  TG --> ArgoCD
  TG --> Grafana
  LBC -. reconcile TargetGroupBinding and register Pod IPs .-> TG
  API --> DDB[(DynamoDB state, jobs and history)]
  API --> SQS[(SQS jobs)]
  SQS --> Worker
  Worker --> DDB
  Worker -->|REST resource operations| ArgoCD
  Worker -->|AssumeRole and ExternalId| Accounts[Target AWS resources]
  Atlantis -->|Reviewed Terraform apply| Accounts
  ArgoCD --> Spokes[Tenant EKS spokes]
  SM[(Secrets Manager)] --> ESO
  SM -->|Scoped credential reads| Worker
  ESO -. Kubernetes Secret .-> Grafana
```

The dashboard uses one viewer origin (`admin-dev.atomai.click`) with distinct
CloudFront origins for frontend and API traffic. `/api/*` goes to
`admin-api-dev.atomai.click` at the ALB; `AllViewerExceptHostHeader` supplies the
origin Host and forwards Authorization. `CachingDisabled` prevents authentication
and mutations from being cached. The browser sends a Cognito access token; AWS
credentials remain in the backend's role/assume-role path.

Grafana keeps AllViewer and disabled caching; both viewer hosts match its ALB
rule. Its public availability depends on the external repository's CloudFront
configuration, not just this repository's ArgoCD status.

## Dashboard operations

PR #107 adds a default operating table, an alternate card view and sorting by
attention, name or account. Selected projects form a confirmed on/off batch;
its names and membership are frozen. Before dispatch, each target is checked
against the latest loaded project state, not live resource health.

[`useOperations`](../dashboard/frontend/hooks/useOperations.ts) coordinates bulk
and single lifecycle actions and scale, with a per-project guard and at most four
active operations per mounted page. A bulk run blocks individual mutations;
closing its drawer does not release a project's active guard. These are local
controls, not backend or cross-client locks.

[`OperationPanel`](../dashboard/frontend/components/OperationPanel.tsx) tracks
queued/running/succeeded/failed/skipped batch results and offers failed-item retry.
It dispatches existing per-project API jobs; there is no durable server-side batch.
In-page Refresh retains the batch/results while reloading project state. A full
reload or navigation that unmounts the page loses local results and undispatched
work, with no automatic queue or job-polling resume. Submitted backend jobs continue.
A polling timeout can release the local guard while a job continues, so a failed
UI result does not prove that no resource changed. See the
[frontend guide](../dashboard/frontend/CLAUDE.md) for the current interaction contract.

## Lifecycle and scale jobs

`shared` owns schemas/clients; API routes validate and persist jobs, then enqueue
SQS work with a 202 response. Lifecycle jobs set `transitioning`; workers resume
running jobs and use the queue's three-receive redrive policy
([ADR-001](decisions/ADR-001-sqs-worker-for-async-jobs.md)).

Off/on preserves resource-specific restoration data. Kubernetes off pins HPA bounds
and workload replicas to 1 through ArgoCD REST; failed on retains the saved data
([ADR-002](decisions/ADR-002-argocd-control-via-rest-api.md)).

Scale requires `on`, leaves that status unchanged and persists its targets.
Write-once HPA baselines survive repeated scales for later off/on restoration;
[ADR-017](decisions/ADR-017-demo-scale-job-operation.md) records accepted races
and partial failures. See the [project guide](../projects/CLAUDE.md) for supported
controllers, visibility-only types and schema fields that do not change behavior.

## Runtime and deployment contracts

- The configured platform compute region is `ap-northeast-2`; CloudFront is global
  and its existing viewer certificate is looked up in `us-east-1`.
- Terraform initializes API/frontend counts at 1 and worker at 0. Services ignore
  `task_definition` and `desired_count` drift; these values are not live counts.
- Backend/frontend CI publishes ARM64 images on matching main changes; ECS rollout
  is explicit. Verify the selected task revision, actual digest/count and health.
- Backend CI bundles project YAMLs into API/worker images and account configuration
  into the worker. Its current path filters cover `dashboard/backend/**` and its
  workflow file, so project/account-only changes require an explicit build/deploy
  step; merging those files alone does not refresh the running platform metadata.
- Kubernetes components auto-sync from Git. Provision a target group before merging
  its binding; require a Secret producer Ready before enabling its consumer.
- Hub bootstrap nodes, Karpenter platform pools and runner pools have different
  selectors/taints. Follow the [manifest map](../k8s/CLAUDE.md), not a blanket
  hub toleration rule. Only paths selected by Applications are auto-synced.
- Grafana rotation updates the database, authoritative secret and consumers in order;
  see its runbook. Secret changes or consumer reverts alone do not rotate/restore
  the persisted password.

Resolve endpoint identifiers from the owning modules/APIs, then validate public TLS,
login and data access. Historical incident IDs are not an active inventory, and
checks through private split-horizon DNS do not exercise CloudFront.

## Terraform modules

Each root module uses its own key in `multi-region-mall-terraform-state` with
DynamoDB locking. Keep Terraform 1.9.6 and `dynamodb_table` consistent with Atlantis.
Remote-state consumers need their dependencies applied before a meaningful plan.

| Module | Purpose |
| --- | --- |
| `infra/eks-mgmt` | Authoritative hub cluster and shared runner identity |
| `infra/atlantis-bootstrap` | Atlantis identity/policy and GitHub App secret containers |
| `infra/alb-internal` | Internal ALB, SG, HTTPS rules and IP target groups including Grafana |
| `infra/cloudfront` | Platform distributions and shared VPC Origin; Grafana distribution is externally owned |
| `infra/route53-private-zone` | Platform public aliases and private hosted-zone records |
| `infra/cognito` | Admin user pool, public SPA client and Cognito ID publication |
| `infra/dashboard-ecs` | API, worker and frontend Fargate runtime definitions |
| `infra/iam` | Task/execution/operator roles and scoped GitHub OIDC roles |
| `infra/dynamodb` | Lifecycle state, jobs and history tables |
| `infra/sqs` | Job queue and DLQ |
| `infra/ecr` | Three runtime image repositories and optional GHCR cache; existing runner repository is outside this state |
| `infra/secrets-manager` | Dashboard credential containers plus the Grafana admin container |
| `infra/modules` | Reusable submodules; not independently applied states |

Use `demo-platform-` for new platform-owned names. Adopted `mall-*` resources,
existing role names and shared state keys retain their names; the prefix rule
does not require replacement. See the [infrastructure guide](../infra/CLAUDE.md).

## Security and review boundaries

The platform ALB permits HTTPS only from the CloudFront VPC Origin source SG and
`10.0.0.0/8`. Do not expand to other RFC1918 ranges or open ingress. ADR-007's
internal observability NLBs serve private fan-in and are not a public UI exception.
Reuse wildcard certificates; use certificate-compatible HTTPS origin hostnames.

Cross-account calls assume the configured role with an ExternalId from Secrets
Manager. Backend auth fails closed except for the literal development environment;
verified access-token usernames must be in `ADMIN_USERNAMES`. CI image publication
uses repository/main-scoped GitHub OIDC, not long-lived AWS keys.
The worker consumes `accounts.yaml`; Atlantis's standard workflow does not.
Friend-account Terraform providers and repository registration need explicit
wiring. Trust conditions do not imply every permission is resource-scoped; review
the actual [IAM statements](../infra/iam/CLAUDE.md).

AI roster/configuration, successful model responses and verified findings are
different evidence. Use [review/release](runbooks/review-and-release.md) for
current-head coverage and actual branch-rule checks; historical proposals do not
establish implemented enforcement.

The [decision records](decisions/) retain rationale and dated exceptions.
In particular, ADR-007 scopes private fan-in, ADR-012 scopes the external
ai-trader-web OIDC split, and ADR-018 records Grafana's cross-owner recovery.
Model roster/endpoint history is not a substitute for current review scripts.

## Operations

- [Review and release](runbooks/review-and-release.md): checks, plans, controlled cutover and incident exceptions.
- [Grafana ingress and credentials](runbooks/grafana-private-ingress.md): resource owners, staged Secret rollout and live checks.
- [ECS runtime guide](../infra/dashboard-ecs/CLAUDE.md): initial definitions versus actual revisions/counts.
- [ARM64 migration record](runbooks/arm64-graviton-migration.md): historical migration mechanics, not current service status.
- [Public dashboard rollout](runbooks/dashboard-public-deploy-execution.md): explicit revision selection and public checks; June 2026 observations are historical.
- [Developer onboarding](onboarding.md) and [friend-account onboarding](onboarding/friend-account-setup.md).
