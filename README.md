# AWS Demo Platform

Admin platform for managing demo projects across multiple AWS accounts.

See `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` for the full design.

## Repository structure

| Path | Purpose |
|---|---|
| `accounts.yaml` | Target AWS accounts (cross-account assume-role config) |
| `projects/*.yaml` | Per-project metadata (resources, URLs, on/off targets) |
| `infra/` | Terraform — hub cluster, network, IAM, dashboard infra |
| `k8s/system/` | Kustomize manifests for hub cluster system components |
| `argocd-apps/system/` | ArgoCD Application CRs for system components |
| `argocd-apps/tenants/` | ArgoCD root Application CRs for each tenant project (App-of-Apps) |
| `argocd-apps/bootstrap/` | Master-root Applications (one-time bootstrap) |
| `dashboard/` | Stage 3: admin UI + API (Next.js + Node.js TS) |
| `docs/superpowers/` | Specs, plans, ADRs |
| `docs/onboarding/` | Friend account onboarding guides |

## Operating model

- Non-production environment. Brief outages OK.
- Two environments: `main` branch → dev; semver tag → prod.
- Terraform changes go through Atlantis (PR `atlantis plan` / `atlantis apply`).
- k8s changes go through ArgoCD (auto-sync on hub).

See spec for full architecture details.
