# k8s/ Module

## Role
Kustomize manifests for hub cluster (`mall-apne2-mgmt`) system components. Repo-owned manifests live here; upstream third-party charts (ArgoCD, ESO) are referenced from `argocd-apps/system/` instead.

## Key Directories
- `system/atlantis/` — Atlantis deployment, service, ServiceAccount (annotated with `AtlantisIRSARole`), ExternalSecret (`v1`), config. The deployment includes `--write-git-creds` for GitHub App auth.
- `system/argocd/` — Helm values file for ArgoCD self-managed install (chart `argo/argo-cd` 9.5.15). `configs.cm` contains the HPA-2 cluster-wide `ignoreDifferences`. Tolerations for `node-role=system-critical`.
- `system/external-secrets-bootstrap/` — One-time bootstrap manifests adopted by ArgoCD (`cluster-secret-store.yaml`, `helm-values.yaml`). Documented in its own README.
- `system/tempo/` — Grafana Tempo 2.7.2 single-binary (S3 backend, IRSA `production-tempo-ap-northeast-2-mgmt`, bucket from `infra/eks-mgmt` `tempo_storage`). Synced to mgmt only via `appset-tempo`. Uses `-config.expand-env=true`; the appset patches `containers[0].env` with literal `AWS_REGION`/`TEMPO_S3_BUCKET` (the in-manifest `tempo-region-config`/`region-config` refs are `optional` and unused).
- `system/clickhouse-mgmt/` — Altinity `ClickHouseInstallation` (otel traces/logs schema, gp3 100Gi, `node-pool=platform`) + 3 internal NLBs (`clickhouse-nlb`/`tempo-nlb`/`prometheus-nlb`) for spoke→hub fan-in. Synced to mgmt only via `appset-clickhouse`; operator via `appset-helm-clickhouse-operator`. The NLBs are a documented no-NLB-convention exception — see ADR-007.

## Rules
- **kube context** — always run `kubectl config current-context` and confirm `mall-apne2-mgmt` before any cluster op. Spoke workloads are NOT managed here.
- **Tolerations required** — hub nodes have taints (`workload-type=platform`, `node-role=system-critical`). All workloads here must tolerate them.
- **ExternalSecret API version** — use `external-secrets.io/v1`. `v1beta1` is deprecated in ESO 2.5.0.
- **Atlantis `--write-git-creds`** — required flag for GitHub App auth. Do not strip.
- **Validate before commit** — `kubectl kustomize k8s/system/<dir>` must succeed.
- **No Ingress resources** — connectivity is via TargetGroupBinding (TGB), TGs are in Terraform.
