# Kubernetes manifests

The owning Application/ApplicationSet in `argocd-apps/system/` determines the
destination. `k8s/system/` includes hub components and spoke overlays. Upstream
Helm chart versions are pinned in those Applications; declarations are not proof
of the installed version.

## Source map

| Directory under `system/` | Responsibility |
| --- | --- |
| `karpenter/` | Shared NodePool/EC2NodeClass manifests; the base is not a hub-only deployment |
| `karpenter-apne2-{mgmt,az-a,az-c}/` | Cluster-specific selections/patches, mapped by `appset-infra.yaml` |
| `atlantis/` | Deployment, IRSA ServiceAccount, ExternalSecret, service and binding; preserve `--write-git-creds` |
| `argocd/` | Self-managed Helm values and bootstrap binding; see its README for ownership limits |
| `external-secrets-bootstrap/` | Still-referenced Helm values and ClusterSecretStore; retained by current ArgoCD Applications |
| `actions-runner/`, `runner-scheduler/` | Shared runner identity/secrets and scheduled fleet sizing |
| `storageclass/` | gp3 StorageClass |
| `tempo/` | Single-binary Tempo; `appset-tempo.yaml` supplies IRSA, S3 bucket and literal environment values |
| `clickhouse-mgmt/` | ClickHouseInstallation and three internal observability fan-in NLB Services |
| `grafana/` | 11 generated dashboard ConfigMaps, TargetGroupBinding and `grafana-admin` ExternalSecret |

The unselected `multi-region-comparison.json` is retained source, not a deployed
dashboard. Tempo's optional ConfigMap references are replaced by its ApplicationSet;
do not treat those optional maps as required deployment prerequisites.

## Scheduling

Match the destination, node selector and that pool's taint; hub nodes do not all
carry the same taints.

| Pool | Selector / taint (`NoSchedule`) | Source |
| --- | --- | --- |
| Bootstrap system nodes | `role=system` / `node-role=system-critical` | `infra/modules/compute/eks/main.tf` |
| Karpenter platform | `node-pool=platform` / `workload-type=platform` | `system/karpenter/platform-nodepool.yaml` |
| General runner pools | Architecture/pool constraints / `workload-type=ci-runner` | `system/karpenter/runner-{arm,x86}-nodepool.yaml` |
| Docs runner pool | `node-pool=runner-docs-arm` / `workload-type=ci-runner-docs` | `system/karpenter/runner-docs-nodepool.yaml` |

## Operations

Verify the selected context's cluster/account against the Application destination;
pass `--context` on cluster operations. Render directories with a Kustomization
using `kubectl kustomize <dir>`; the Karpenter overlays need
`--load-restrictor LoadRestrictionsNone` for sibling resources, as configured in
ArgoCD. Helm-values and directory-source folders are not standalone Kustomizations.
Follow with an appropriate dry-run after prerequisites exist.

ExternalSecrets use `external-secrets.io/v1`; the ESO chart pin is 2.5.0.
For Grafana, apply its target group before syncing the binding, and verify the
Secret producer before rolling consumers. See the
[Grafana runbook](../docs/runbooks/grafana-private-ingress.md).

Public ingress is CloudFront → VPC Origin → internal ALB → Pod IPs. The AWS Load
Balancer Controller reconciles TargetGroupBinding to register those IPs from
Services; TGB is not a traffic hop. No Kubernetes Ingress or public Grafana
LoadBalancer is required. [ADR-007](../docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md)
permits only private spoke-to-hub observability fan-in NLBs.
