# argocd-apps/ Module

## Role
ArgoCD Application CRs for the App-of-Apps pattern on the hub cluster.

## Key Directories
- `bootstrap/` — One-time apply: `master-system-root.yaml` (watches `argocd-apps/system/`), `master-tenants-root.yaml` (watches `argocd-apps/tenants/`).
- `system/` — System Applications (atlantis, argocd self-managed, external-secrets, cluster-secret-store). `master-system-root` discovers these.
- `tenants/` — Per-project root Applications (e.g., `multi-region-mall-az-a.yaml`). `master-tenants-root` discovers these.

## Conventions
All Applications here use `project: default` for Stage 1, since multi-project RBAC is intentionally deferred to a future stage rather than something this stage needs to solve.

For Helm-installed components, values are meant to go through PR review, which is why the convention is a `sources:` array (chart pulled from the helm repo, values file pulled from this Git repo via a `$values` ref) rather than inlining the values directly into the Application.

Sync policy follows `automated: { selfHeal: true, prune: <varies> }`, with the prune setting chosen per safety profile: `prune: false` for the self-managed argocd Application (so ArgoCD can't prune itself into a bad state) and `prune: true` for atlantis and tenant Applications. `ServerSideApply=true` should always be included alongside it.

Tenant (workload) Applications use `Replace=true` because it avoids sync conflicts during transitions — a concern specific enough to workload Applications that it doesn't need to be the default elsewhere.

Because the HPA-2 `ignoreDifferences` rule is already defined cluster-wide in `argocd-cm` (in `k8s/system/argocd/values.yaml`), individual Applications generally don't need to repeat their own HPA ignoreDifferences; a per-app override is only worth adding for a non-HPA quirk specific to that app.

Onboarding a new project is just a matter of dropping a YAML file in `argocd-apps/tenants/` that points at the project's manifest repo, path, and spoke cluster — `master-tenants-root` will pick it up within one sync interval without further wiring.

Spoke clusters need to be registered before anything can target them, via `argocd cluster add --upsert <kubeconfig-context>`. Those registrations live as Secrets in the `argocd` namespace, and since they don't automatically survive an ArgoCD restart, backing them up to Secrets Manager is still an open TODO rather than a solved problem.
