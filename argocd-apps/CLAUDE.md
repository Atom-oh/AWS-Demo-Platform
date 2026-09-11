# argocd-apps/ Module

## Role
ArgoCD Application CRs for the App-of-Apps pattern on the hub cluster.

## Key Directories
- `bootstrap/` — One-time apply: `master-system-root.yaml` (watches `argocd-apps/system/`), `master-tenants-root.yaml` (watches `argocd-apps/tenants/`).
- `system/` — System Applications (atlantis, argocd self-managed, external-secrets, cluster-secret-store). `master-system-root` discovers these.
- `tenants/` — Per-project root Applications (e.g., `multi-region-mall-az-a.yaml`). `master-tenants-root` discovers these.

## Conventions
All Applications here use `project: default` for Stage 1, since multi-project RBAC is intentionally deferred to a future stage rather than something this stage needs to solve.

Helm values go through PR review. Some components use multi-source chart/`$values` references, while existing ApplicationSets such as Prometheus use inline `helm.valuesObject`. Follow the component's actual source layout when changing values; do not assume every Application uses a `sources:` array.

Sync policy follows `automated: { selfHeal: true, prune: <varies> }`, with the prune setting chosen per safety profile: `prune: false` for the self-managed argocd Application (so ArgoCD can't prune itself into a bad state) and `prune: true` for atlantis and tenant Applications. `ServerSideApply=true` should always be included alongside it.

Tenant (workload) Applications use `Replace=true` because it avoids sync conflicts during transitions — a concern specific enough to workload Applications that it doesn't need to be the default elsewhere.

Because the HPA-2 `ignoreDifferences` rule is already defined cluster-wide in `argocd-cm` (in `k8s/system/argocd/values.yaml`), individual Applications generally don't need to repeat their own HPA ignoreDifferences; a per-app override is only worth adding for a non-HPA quirk specific to that app.

For hub-managed tenant workloads, add the appropriate Application(s) with the correct source repo, path and destination, alongside schema-valid platform metadata. Direct AWS or visibility-only projects do not require a tenant root. Backend metadata is baked into images and needs a build/rollout separately from ArgoCD synchronization.

Producer and consumer Applications do not have an implicit sync order. The Grafana dashboard Application produces `monitoring/grafana-admin`; the Prometheus Application consumes it. Require the Secret to be Ready and its persisted administrator credential verified before enabling the consumer. Do not prune the producer while it is in use.

Spoke clusters need to be registered before anything can target them, via `argocd cluster add --upsert <kubeconfig-context>`. Those registrations live as Secrets in the `argocd` namespace, which survive pod/ArgoCD restarts fine on their own — what they don't survive is losing the namespace or the hub cluster itself, so backing them up to Secrets Manager is still an open TODO rather than a solved problem.
