# argocd-apps/ Module

## Role
ArgoCD Application CRs for the App-of-Apps pattern on the hub cluster.

## Key Directories
- `bootstrap/` — One-time apply: `master-system-root.yaml` (watches `argocd-apps/system/`), `master-tenants-root.yaml` (watches `argocd-apps/tenants/`).
- `system/` — System Applications/ApplicationSets for automation, observability, runners and cluster overlays. `master-system-root` discovers these.
- `tenants/` — Per-project root Applications (e.g., `multi-region-mall-az-a.yaml`). `master-tenants-root` discovers these.

## Conventions
Applications here use `project: default`; separate AppProject RBAC is not
implemented by these manifests.

Helm values go through PR review. Some components use multi-source chart/`$values` references, while existing ApplicationSets such as Prometheus use inline `helm.valuesObject`. Follow the component's actual source layout when changing values; do not assume every Application uses a `sources:` array.

Read each manifest's sync policy. The bootstrap roots and Atlantis prune;
ArgoCD, ESO, ClusterSecretStore and both current tenant workload roots use
`prune: false`. Several ApplicationSets have different sync options; neither
`ServerSideApply=true` nor a particular prune setting is universal. Parent
pruning and Application finalizers still matter when deleting a child Application.

The two tenant roots use `Replace=true` for legacy structured-merge conflicts.
Some system Applications also use it (for example Tempo); do not prescribe it for
every new workload or assume it is tenant-only.

Because the HPA-2 `ignoreDifferences` rule is already defined cluster-wide in `argocd-cm` (in `k8s/system/argocd/values.yaml`), individual Applications generally don't need to repeat their own HPA ignoreDifferences; a per-app override is only worth adding for a non-HPA quirk specific to that app.

For hub-managed tenant workloads, add the appropriate Application(s) with the
correct source repo, path and destination, alongside schema-valid platform metadata.
Current tenant roots are `workloads-apne2-az-a` and `workloads-apne2-az-c`, both
from `Atom-oh/multi-region-architecture`. Direct AWS or visibility-only projects
do not require a tenant root. Backend metadata needs its own image build/rollout.

Producer and consumer Applications do not have an implicit sync order. The Grafana dashboard Application produces `monitoring/grafana-admin`; the Prometheus Application consumes it. Require the Secret to be Ready and its persisted administrator credential verified before enabling the consumer. Do not prune the producer while it is in use.

Register a spoke with `argocd cluster add --upsert <verified-kubeconfig-context>`
before targeting it. Check the account/cluster first; ApplicationSet generators
also require their matching cluster labels. Registration Secrets live in `argocd`;
the repository does not implement a backup/restore workflow for them. Namespace
or hub loss requires recovery beyond restarting ArgoCD.
