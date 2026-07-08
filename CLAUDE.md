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
- **AI PR review** — `pr-review.yml` on the `aws-demo-platform-claude-arm` runner: a lens×model matrix (L2–L5, each reviewed independently by Codex via Bedrock + Kiro `claude-opus-4.8`/`gpt-5.5`/`glm-5` via `kiro-cli chat` (no `--v3` — it routes to a narrower catalog that rejects `gpt-5.5`, ADR-011) + a Claude self-review, 5 models × 4 lenses = 20 cells) feeds a **Claude Fable 5 chair** that synthesizes one lens-grouped review + `VERDICT` (fail-closed gate). Orchestration in `scripts/pr-review/`. Runner image built in-repo (`docker/actions-runner-claude/` + `runner-image.yml`), **rebuilt weekly** (Sun 03:00 KST cron, best-effort) and shipping baked Claude Code plugins (`codex@openai-codex`, `code-review@`/`github@claude-plugins-official`, Codex plugin pre-configured). Kiro auth via `KIRO_API_KEY` from Secrets Manager `/demo-platform/actions/AI-key` (ExternalSecret `ai-panel-keys`). Antigravity/`agy` is intentionally absent because headless API-key auth does not work. **Runner pods use the shared `claude-runner` SA → `mall-apne2-mgmt-ci-runner` role (Bedrock + bedrock-mantle) via EKS Pod Identity; this SA must be in `infra/eks-mgmt` `runner_service_accounts` or codex loses bedrock-mantle creds.** See [ADR-007](docs/decisions/ADR-007-multi-ai-pr-review-panel.md), [ADR-011](docs/decisions/ADR-011-pr-review-kiro-roster-gpt55-drop-v3.md).
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

```
accounts.yaml             - Target AWS accounts (cross-account assume-role config)
projects/                 - Per-project metadata (resources, URLs, on/off targets)
infra/                    - Terraform (hub cluster, network, IAM, dashboard infra)
  eks-mgmt/               - Hub EKS cluster cross-repo state
  atlantis-bootstrap/     - AtlantisIRSARole + Secrets Manager slots
  alb-internal/           - Internal ALB + SG rules
  cloudfront/             - CloudFront distribution + VPC Origin
  route53-private-zone/   - Split-horizon DNS PHZ
  dynamodb/               - Lifecycle Controller state/jobs/history tables (Stage 2, dev)
  iam/                    - DashboardEcsTaskRole-dev, ExecutionRole-dev, DemoPlatformOperator (Stage 2)
  sqs/                    - Lifecycle Controller job queue + DLQ (Stage 2, dev)
  ecr/                    - demo-platform/{api,worker} image repos (Stage 2)
  secrets-manager/        - Dashboard secret slots: github PAT, argocd token, cognito (Stage 2)
  cognito/                - Admin auth (Stage 2 Phase 4)
  dashboard-ecs/          - Dashboard runtime ECS (Stage 2 Phase 4)
  modules/                - Shared Terraform modules (copied from multi-region-architecture)
k8s/system/               - Kustomize manifests for hub system components
  atlantis/               - Atlantis deployment + ExternalSecret
  argocd/                 - ArgoCD helm values (HPA-2 ignoreDifferences)
  external-secrets-bootstrap/  - One-time CSS adoption manifest
argocd-apps/
  bootstrap/              - master-system-root + master-tenants-root (one-time apply)
  system/                 - System Applications (atlantis, argocd, external-secrets, CSS)
  tenants/                - Per-tenant root Applications (App-of-Apps targeting spokes)
dashboard/
  backend/                - Stage 2 Lifecycle Controller (pnpm monorepo: shared/api/worker) [built]
  frontend/               - Stage 3 admin UI (Next.js) [scaffold only]
docs/
  superpowers/            - Specs, plans, retrospectives
  onboarding/             - Friend account setup guides
  decisions/              - ADRs
  runbooks/               - Operational runbooks
.claude/                  - Claude Code settings, hooks, skills, commands, agents
scripts/                  - Setup, hook installer
tools/                    - Prompts, helper scripts
tests/                    - Harness validation suite
```

## Conventions

- **Cross-account access**: assume `OperatorRole` (read) or `DemoPlatformTerraformer` (write) per account in `accounts.yaml`. ExternalId stored in Secrets Manager `/demo-platform/external-ids/<account>/<role>`.
- **CloudFront-only ingress**: every load balancer SG accepts only the CF VPC Origin source SG + `10.0.0.0/8`. No public ALB/NLB. No Kubernetes Ingress.
- **TargetGroupBinding (TGB) pattern**: TGs are created in Terraform; pods are bound via TGB CRD (no Ingress).
- **HPA-2 pattern**: instead of patching replicas to 0 for demo-off, patch HPA `min=max=1`. ArgoCD `ignoreDifferences` covers Deployment/StatefulSet `/spec/replicas` and HPA `/spec/minReplicas`+`/spec/maxReplicas` cluster-wide.
- **Atlantis flag**: `--write-git-creds` is required for GitHub App auth — don't strip it from the deployment.
- **ACM cert**: always use the pre-existing `*.atomai.click` wildcard via `data "aws_acm_certificate"` lookup. Don't issue new certs.
- **kube context safety**: always verify `kubectl config current-context` before running cluster-scoped operations. Available contexts are full EKS ARNs (e.g., `arn:aws:eks:ap-northeast-2:180294183052:cluster/mall-apne2-mgmt`) and the short aliases `az-a` / `az-c` for spokes.
- **Naming**: Terraform resources prefixed with `demo-platform-`. AWS Secrets Manager paths under `/demo-platform/...`.

## Key Commands

```bash
# Terraform (per-directory)
cd infra/<module> && terraform init && terraform plan

# Atlantis-driven (preferred for PRs)
# In PR comments:
#   atlantis plan -d infra/<module>
#   atlantis apply -d infra/<module>

# ArgoCD CLI (against hub)
argocd login argocd.atomai.click
argocd app list
argocd app sync <app-name>

# kubectl (verify context FIRST)
kubectl config current-context     # must show mall-apne2-mgmt for hub ops
kubectl get applications -n argocd

# Validate K8s manifests
kubectl kustomize k8s/system/atlantis | kubectl apply --dry-run=client -f -

# Project setup
bash scripts/setup.sh

# Run harness tests
bash tests/run-all.sh
```

---

## Auto-Sync Rules

Rules below are applied automatically after Plan mode exit and on major code changes.

### Post-Plan Mode Actions

After exiting Plan mode (`/plan`), before starting implementation:

1. **Architecture decision made** → Update `docs/architecture.md`
2. **Technical choice/trade-off made** → Create `docs/decisions/ADR-NNN-title.md`
3. **New module added** → Create `CLAUDE.md` in that module directory
4. **Operational procedure defined** → Create runbook in `docs/runbooks/`
5. **Changes needed in this file** → Update relevant sections above

### Code Change Sync Rules

- New directory under `infra/` → Create `CLAUDE.md` alongside; update `docs/architecture.md` Infrastructure table
- New directory under `k8s/system/` → Create `CLAUDE.md` alongside; ensure matching `argocd-apps/system/<name>.yaml` exists
- New directory under `argocd-apps/` → Update `docs/architecture.md` GitOps section
- Project added under `projects/` → Update App-of-Apps coverage; create runbook if onboarding flow differs
- Terraform module changed → Update `docs/architecture.md` Infrastructure section
- `accounts.yaml` changed → Update `docs/onboarding/friend-account-setup.md`

### ADR Numbering

Find the highest number in `docs/decisions/ADR-*.md` and increment by 1.
Format: `ADR-NNN-concise-title.md`
