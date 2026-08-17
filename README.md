# AWS Demo Platform

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.1-green.svg)]()

Admin platform for managing GitHub-linked AWS demo projects across multiple AWS accounts.

## Overview

AWS Demo Platform unifies operation of multiple AWS demo projects under a single admin surface. A hub EKS cluster runs Atlantis (PR-based Terraform automation), ArgoCD (GitOps for spoke workloads), and the future admin dashboard. Operators can discover projects from GitHub, toggle AWS resources on/off, surface demo URLs and code-server URLs, and manage Secrets Manager entries — all through a CloudFront-fronted control plane.

Stage 1 (infrastructure migration) is complete. Stage 2 (Lifecycle Controller) is **deployed to dev** — backend code (Phase 1), foundational infra (Phase 2: DynamoDB/IAM/SQS/ECR/Secrets), the GHA OIDC→ECR image pipeline (Phase 3), and the ECS/ALB/CloudFront/Route53/Cognito runtime (Phase 4) are all live. The `api` service answers at `https://admin-api-dev.atomai.click/health`; the `worker` is scaffolded (desiredCount=0) pending secret population + config bundling. The frontend (Stage 3) is scaffolded.

See `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` for the full design and `docs/architecture.md` for the deployed topology.

## Features

- **Hub-spoke control plane** — One EKS hub (`mall-apne2-mgmt`) manages multiple spoke clusters across AZs and (soon) accounts.
- **PR-driven Terraform** — Atlantis runs `plan` and `apply` from PR comments using IRSA + cross-account assume-role.
- **App-of-Apps GitOps** — Two ArgoCD master roots watch `argocd-apps/system/` (control plane) and `argocd-apps/tenants/` (project workloads). New project = one YAML file.
- **CloudFront-only ingress** — Internal ALB behind CF VPC Origin. No public LBs, no Kubernetes Ingress.
- **Multi-account by design** — Cross-account assume-role with ExternalId, configured via `accounts.yaml`.

## Prerequisites

- AWS CLI v2 configured for the `atomoh-main` account
- Terraform 1.9.8 (NOT 1.10+; backend uses `dynamodb_table` not `use_lockfile`)
- kubectl with hub + spoke contexts
- ArgoCD CLI
- GitHub access to `Atom-oh/AWS-Demo-Platform` and `Atom-oh/multi-region-architecture`
- Read access to `/demo-platform/*` in AWS Secrets Manager

## Installation

```bash
# Clone the repository
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform

# Run setup
bash scripts/setup.sh

# Initialize Terraform for a module
cd infra/<module>
terraform init
```

## Usage

```bash
# Terraform (preferred path: through Atlantis PR comments)
#   atlantis plan -d infra/<module>
#   atlantis apply -d infra/<module>

# ArgoCD CLI
argocd login argocd.atomai.click
argocd app list
argocd app sync <name>

# Validate K8s manifests locally
kubectl kustomize k8s/system/atlantis | kubectl apply --dry-run=client -f -

# Run harness tests
bash tests/run-all.sh
```

## Project Structure

| Path | Purpose |
|---|---|
| `accounts.yaml` | Target AWS accounts (cross-account assume-role config) |
| `projects/*.yaml` | Per-project metadata (resources, URLs, on/off targets) |
| `infra/` | Terraform — hub cluster, network, IAM, dashboard infra |
| `k8s/system/` | Kustomize manifests for hub cluster system components |
| `argocd-apps/system/` | ArgoCD Application CRs for system components |
| `argocd-apps/tenants/` | ArgoCD root Application CRs per tenant project (App-of-Apps) |
| `argocd-apps/bootstrap/` | Master-root Applications (one-time bootstrap) |
| `dashboard/backend/` | Stage 2 Lifecycle Controller (Node.js TS pnpm monorepo: shared/api/worker, built) |
| `dashboard/frontend/` | Stage 3 admin UI (Next.js, scaffold) |
| `docs/superpowers/` | Specs, plans, retrospectives |
| `docs/onboarding/` | Friend account onboarding guides |
| `docs/decisions/` | ADRs |
| `docs/runbooks/` | Operational runbooks |
| `scripts/` | Setup, hook installer |
| `tests/` | Harness validation suite |
| `.claude/` | Claude Code settings, hooks, skills, commands, agents |

## Operating Model

- Non-production environment. Brief outages OK.
- Two environments: `main` branch → dev; semver tag → prod.
- Terraform changes go through Atlantis (PR `atlantis plan` / `atlantis apply`).
- K8s changes go through ArgoCD (auto-sync on hub).

## Testing

```bash
# Harness tests (hook scripts, secret patterns, structure invariants)
bash tests/run-all.sh

# Terraform validate (per module)
cd infra/<module> && terraform fmt -check && terraform validate

# Kustomize build (per overlay)
kubectl kustomize k8s/system/<overlay>
```

## Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request — Atlantis will comment back with `plan` output for `infra/**` changes

## License

MIT — see [LICENSE](LICENSE) when added.

## Contact

- Maintainer: [Atom-oh](https://github.com/Atom-oh)
- Issues: [GitHub Issues](https://github.com/Atom-oh/AWS-Demo-Platform/issues)
