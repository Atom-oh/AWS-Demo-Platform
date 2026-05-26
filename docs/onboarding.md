# Developer Onboarding

## Quick Start

### 1. Prerequisites
- [ ] AWS CLI v2 installed and configured for the `atomoh-main` account
- [ ] Terraform 1.9.8 (NOT 1.10+ — backend uses `dynamodb_table` not `use_lockfile`)
- [ ] kubectl with kubeconfig for hub (`mall-apne2-mgmt`) and spokes (`mall-apne2-az-{a,c}`)
- [ ] ArgoCD CLI (`brew install argocd` or equivalent)
- [ ] GitHub access to `Atom-oh/AWS-Demo-Platform` and `Atom-oh/multi-region-architecture`
- [ ] Read-access to AWS Secrets Manager path `/demo-platform/*` (for ExternalIds, admin password)

### 2. Setup

```bash
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform
bash scripts/setup.sh
```

For each Terraform module you will work on:

```bash
cd infra/<module>
terraform init
terraform plan
```

For ArgoCD CLI access:

```bash
ADMIN=$(aws secretsmanager get-secret-value \
  --secret-id /demo-platform/argocd/admin-password \
  --query SecretString --output text)
argocd login argocd.atomai.click --username admin --password "$ADMIN"
```

### 3. Verify

```bash
# Project structure
bash tests/run-all.sh

# kube context (must show mall-apne2-mgmt for hub ops)
kubectl config current-context

# ArgoCD apps
argocd app list

# Atlantis healthcheck
curl -sf https://atlantis.atomai.click/healthz
```

## Project Overview

Read in order:
- `CLAUDE.md` — project context, conventions, key commands
- `docs/architecture.md` — system design with hub-spoke diagram
- `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` — original design spec
- `docs/superpowers/retrospectives/2026-05-26-stage-1.md` — what was built, surprises encountered
- `docs/decisions/` — ADRs (architectural choices)
- `docs/onboarding/friend-account-setup.md` — how to add a new AWS account

## Development Workflow

- **Branch naming**: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`
- **Commit convention**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)
- **PR process**:
  - For `infra/**`: PR triggers Atlantis. Comment `atlantis plan -d infra/<module>`, review, then `atlantis apply -d infra/<module>`.
  - For `k8s/**`, `argocd-apps/**`, `projects/**`: merge to `main`, ArgoCD auto-syncs.
- **Tagging**: semver `vX.Y.Z`. Stage milestones get a tag.

## Key Concepts

- **Hub** = `mall-apne2-mgmt` EKS cluster, hosts Atlantis + ArgoCD + ESO.
- **Spokes** = `mall-apne2-az-{a,c}` clusters running tenant workloads.
- **App-of-Apps** = two ArgoCD root Applications watch `argocd-apps/system/` and `argocd-apps/tenants/`. Drop a YAML in there, it auto-deploys.
- **HPA-2** = demo on/off uses `min=max=1` on HPA, never `replicas=0`.
- **TGB pattern** = TG in Terraform, pod binds via TargetGroupBinding CRD.
- **CF VPC Origin SG quirk** = ALB SG must explicitly allow the CF VPC Origin source SG (`sg-0a67fc7bfa9c2f0c6`), CIDR alone is insufficient.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `terraform init` fails with backend conflict | Cross-repo backend state | `terraform init -reconfigure` |
| `terraform validate` rejects `use_lockfile` | TF 1.10+ syntax with 1.9.8 | Switch to `dynamodb_table = "multi-region-mall-terraform-locks"` |
| ArgoCD Application stuck OutOfSync | Old resource without owner annotation | ServerSideApply or delete orphaned resource |
| ArgoCD `repo is empty` cache | Stale repo-server cache | `kubectl rollout restart deployment/argocd-repo-server -n argocd` |
| Namespace stuck Terminating | Application finalizers | `kubectl patch ns <ns> -p '{"metadata":{"finalizers":[]}}' --type=merge` |
| Atlantis won't start | Missing `--write-git-creds` flag | Re-add the flag in deployment.yaml |
| CF distribution can't reach ALB | Missing CF source SG ingress | Add `sg-0a67fc7bfa9c2f0c6` to ALB SG ingress rule |
| Pod scheduling fails on hub | Missing toleration for taints | Add `workload-type=platform` or `node-role=system-critical` toleration |

## Resources

- Spec: `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`
- Plan: `docs/superpowers/plans/2026-05-26-stage-1-infra-migration.md`
- Retrospective: `docs/superpowers/retrospectives/2026-05-26-stage-1.md`
- Friend onboarding: `docs/onboarding/friend-account-setup.md`
