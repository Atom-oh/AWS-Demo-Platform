# Project Context

## Overview

**AWS Demo Platform** — Admin platform for managing GitHub-linked AWS demo projects across multiple AWS accounts. Provides a unified dashboard to discover repositories, toggle demo resources (ECS, EC2, ArgoCD apps, RDS) on/off, surface demo URLs and code-server URLs, manage Secrets Manager entries, and operate across 3–5 cross-account environments via assume-role.

- Non-production environment. Brief outages acceptable.
- Two environments: `main` branch → dev; semver tag → prod.
- Terraform changes flow through Atlantis (PR-based `atlantis plan` / `atlantis apply`).
- Kubernetes changes flow through ArgoCD (auto-sync on hub cluster).

See `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` for the full design.

## Tech Stack

- **IaC** — Terraform 1.9.6 (Atlantis-pinned in `atlantis.yaml`; v1.9.8 currently fails to download on an expired upstream HashiCorp GPG key), AWS provider, shared backend bucket `multi-region-mall-terraform-state`
- **Orchestration** — EKS (`mall-apne2-mgmt` hub cluster, spoke clusters `mall-apne2-az-{a,c}`)
- **PR automation** — Atlantis (deployed on hub cluster with IRSA → cross-account `DemoPlatformTerraformer` assume-role)
- **AI PR review** — `pr-review.yml` runs a multi-model lens panel (Codex + Kiro + a Claude self-review) as parallel per-model jobs, each covering lenses L2–L5; a chair job downloads all results and synthesizes one review + a fail-closed `VERDICT`. Orchestration lives in `scripts/pr-review/`. Runner pods need the shared `claude-runner` SA in `infra/eks-mgmt` `runner_service_accounts` or Codex loses Bedrock creds. See [ADR-016](docs/decisions/ADR-016-multi-ai-pr-review-panel.md) for the full design and [ADR-011](docs/decisions/ADR-011-pr-review-kiro-roster-gpt55-drop-v3.md)/[ADR-013](docs/decisions/ADR-013-pr-review-gpt56-model-bump.md)/[ADR-014](docs/decisions/ADR-014-pr-review-opus5-model-bump.md)/[ADR-015](docs/decisions/ADR-015-pr-review-per-model-parallel-jobs.md) for the model-roster/topology amendments.
- **GitOps** — ArgoCD v3.4.2 (Helm chart `argo/argo-cd` 9.5.15), App-of-Apps pattern (`master-system-root` + `master-tenants-root`)
- **Manifests** — Kustomize for system components, Helm for ArgoCD/ESO self-managed
- **Secrets** — AWS Secrets Manager via External Secrets Operator 2.5.0 (`ClusterSecretStore aws-secrets-manager`, ESO `v1` CRDs)
- **Network ingress** — CloudFront → VPC Origin → Internal ALB → TargetGroupBinding → pod (no Ingress controller)
- **DNS** — Route 53 split-horizon (`*.atomai.click` wildcard ACM cert)
- **Auth (admin)** — Cognito (User Pool provisioned in Stage 2 Phase 4)
- **GitHub** — GitHub App `atomoh-atlantis` for Atlantis webhook auth
- **Lifecycle Controller (Stage 2)** — `dashboard/backend/` Node.js TS pnpm monorepo (`shared`/`api`/`worker`). Fastify REST API + SQS worker that toggles ECS/EC2/RDS/ArgoCD via cross-account `DemoPlatformOperator`. State in DynamoDB. **Deployed (dev): api is LIVE at `https://admin-api-dev.atomai.click/health`** (ECS Fargate). Phase 1 (code) ✅, Phase 2 (DDB/IAM/SQS/ECR/Secrets) ✅, Phase 3 (GHA OIDC → ECR push) ✅, Phase 4 (ECS/ALB/CF/R53/Cognito) ✅. worker is scaffolded at desiredCount=0 (see `infra/dashboard-ecs/CLAUDE.md`).
- **Dashboard frontend (Stage 3, scaffold only)** — Next.js → ECS Fargate

## Project Structure

Top-level layout: `accounts.yaml` (cross-account assume-role config) and `projects/`
(per-project metadata) drive the platform. `infra/` holds one Terraform module per
directory (hub cluster, network, IAM, dashboard infra — each module's own `CLAUDE.md`
covers its state key and specifics). `k8s/system/` holds Kustomize manifests for hub
system components; `argocd-apps/` holds the App-of-Apps Application CRs
(`bootstrap/` for the one-time roots, `system/` and `tenants/` for what they discover).
`dashboard/` is the Lifecycle Controller (`backend/`, built) and the admin UI
(`frontend/`, scaffold). `docs/` holds specs/plans/retrospectives, onboarding guides,
ADRs, and runbooks. `.claude/` holds Claude Code config; `scripts/` and `tests/` hold
setup and harness validation.

## Conventions

The goal shaping most decisions here: every public entry point goes through
CloudFront, and cross-account/cross-service credentials always carry an explicit
scope (ExternalId, IAM role, or Secrets Manager path) rather than ambient access.
Concretely:

- **Cross-account access** goes through `OperatorRole` (read) or `DemoPlatformTerraformer`
  (write) per account in `accounts.yaml`, gated by an ExternalId in Secrets Manager
  `/demo-platform/external-ids/<account>/<role>`.
- **Ingress** is CloudFront-only: load balancer SGs accept only the CF VPC Origin
  source SG plus `10.0.0.0/8`, and pods reach their target group via the
  TargetGroupBinding CRD (TGs live in Terraform) rather than a Kubernetes Ingress.
- **Demo on/off** uses the HPA-2 pattern — patch HPA `min=max=1` instead of
  replicas=0 — with a cluster-wide ArgoCD `ignoreDifferences` on
  Deployment/StatefulSet `/spec/replicas` and HPA `/spec/{min,max}Replicas`.
- **Atlantis** needs its `--write-git-creds` flag for GitHub App auth.
- **ACM** reuses the existing `*.atomai.click` wildcard via a `data` lookup rather
  than issuing new certs.
- **kube context**: verify `kubectl config current-context` resolves to the hub
  (`mall-apne2-mgmt`, or alias `az-a`/`az-c` for spokes) before any cluster-scoped op.
- **Naming**: Terraform resources take a `demo-platform-` prefix; Secrets Manager
  paths live under `/demo-platform/...`.
- **Docs are English-only** — ADRs, README, CHANGELOG, runbooks, and code comments.
  `AskUserQuestion` prompts to the user are the one channel that may still be Korean.

## Key Commands

Terraform changes are plan/apply per module directory, normally through Atlantis PR
comments rather than a local `terraform apply`. Kubernetes changes go through ArgoCD
(`argocd app sync`), gated by `kubectl config current-context` resolving to the hub
before any cluster-scoped operation. `bash scripts/setup.sh` bootstraps a new checkout;
`bash tests/run-all.sh` runs the harness validation suite.

---

## Auto-Sync Rules

The intent: keep `docs/architecture.md`, ADRs, module `CLAUDE.md` files, and runbooks
current with the code, rather than letting them drift after a plan-mode session or a
structural change. When exiting plan mode, check whether the change was an
architecture decision, a trade-off worth recording as an ADR, a new module needing its
own `CLAUDE.md`, or an operational procedure needing a runbook — and update the
relevant doc accordingly. The same applies to code changes: a new `infra/` or
`k8s/system/` directory gets a sibling `CLAUDE.md`; a new `argocd-apps/` entry or
`projects/` addition gets `docs/architecture.md` and onboarding docs kept in sync.
New ADRs take the next number after the highest existing `docs/decisions/ADR-*.md`.
