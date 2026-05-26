# argocd-apps/ Module

## Role
ArgoCD Application CRs for the App-of-Apps pattern on the hub cluster.

## Key Directories
- `bootstrap/` — One-time apply: `master-system-root.yaml` (watches `argocd-apps/system/`), `master-tenants-root.yaml` (watches `argocd-apps/tenants/`).
- `system/` — System Applications (atlantis, argocd self-managed, external-secrets, cluster-secret-store). `master-system-root` discovers these.
- `tenants/` — Per-project root Applications (e.g., `multi-region-mall-az-a.yaml`). `master-tenants-root` discovers these.

## Rules
- **Project**: all Applications use `project: default` for Stage 1. Multi-project RBAC is a future enhancement.
- **Helm + Git source for values** — for Helm-installed components, use `sources:` array (chart from helm repo + values file from this Git repo via `$values` ref) instead of inline values, so values are PR-reviewed.
- **Sync policy** — `automated: { selfHeal: true, prune: <varies> }`. `prune: false` for self-managed argocd (safety), `prune: true` for atlantis/tenants. Always include `ServerSideApply=true`.
- **Replace=true on tenants** — workload Applications use `Replace=true` to avoid conflicts during transitions.
- **HPA-2 ignoreDifferences** — defined cluster-wide in `argocd-cm` (in `k8s/system/argocd/values.yaml`), so individual Applications generally do NOT need their own HPA ignoreDifferences. Add per-app overrides only for non-HPA quirks.
- **Adding a new project** — drop a YAML file in `argocd-apps/tenants/` that points at the project's manifest repo+path and the spoke cluster. `master-tenants-root` picks it up within one sync interval.
- **Cluster registration** — spoke clusters must be registered first via `argocd cluster add --upsert <kubeconfig-context>`. Registrations are stored as Secrets in `argocd` namespace; they survive ArgoCD restarts only if backed up to Secrets Manager (TODO).
