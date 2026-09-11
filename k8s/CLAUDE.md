# k8s/ Module

## Role
Kustomize manifests for hub cluster (`mall-apne2-mgmt`) system components. Repo-owned manifests live here; upstream third-party charts (ArgoCD, ESO) are referenced from `argocd-apps/system/` instead.

## Key Directories
- `system/atlantis/` — Atlantis deployment, service, ServiceAccount (annotated with `AtlantisIRSARole`), ExternalSecret (`v1`), config. The deployment includes `--write-git-creds` for GitHub App auth.
- `system/argocd/` — Helm values file for ArgoCD self-managed install (chart `argo/argo-cd` 9.5.15). `configs.cm` contains the HPA-2 cluster-wide `ignoreDifferences`. Tolerations for `node-role=system-critical`.
- `system/external-secrets-bootstrap/` — One-time bootstrap manifests adopted by ArgoCD (`cluster-secret-store.yaml`, `helm-values.yaml`). Documented in its own README.
- `system/tempo/` — Grafana Tempo 2.7.2 single-binary (S3 backend, IRSA `production-tempo-ap-northeast-2-mgmt`, bucket from `infra/eks-mgmt` `tempo_storage`). Synced to mgmt only via `appset-tempo`. Uses `-config.expand-env=true`; the appset patches `containers[0].env` with literal `AWS_REGION`/`TEMPO_S3_BUCKET` (the in-manifest `tempo-region-config`/`region-config` refs are `optional` and unused).
- `system/clickhouse-mgmt/` — Altinity `ClickHouseInstallation` (otel traces/logs schema, gp3 100Gi, `node-pool=platform`) + 3 internal NLBs (`clickhouse-nlb`/`tempo-nlb`/`prometheus-nlb`) for spoke→hub fan-in. Synced to mgmt only via `appset-clickhouse`; operator via `appset-helm-clickhouse-operator`. The NLBs are a documented no-NLB-convention exception — see ADR-007.
- `system/grafana/` — 11 dashboard ConfigMaps plus the `grafana` TargetGroupBinding for the existing monitoring ClusterIP Service. The binding resolves `demo-platform-grafana` by name, so apply `infra/alb-internal` before syncing it. Grafana public access uses the existing CloudFront distribution and shared VPC Origin; no public LoadBalancer Service is provisioned here.
- The same Grafana bundle produces `monitoring/grafana-admin` through an ExternalSecret. Confirm it is Ready before enabling the Helm consumer in `argocd-apps/system/appset-helm-prometheus-mgmt.yaml`; do not prune this producer while the Prometheus/Grafana Application still consumes it.

## Conventions
This directory manages the hub cluster only, so any cluster-scoped operation depends on first confirming the active kube context — running `kubectl config current-context` and checking it reads `mall-apne2-mgmt` — since spoke workloads live elsewhere and are not managed from here.

Hub nodes carry taints (`workload-type=platform`, `node-role=system-critical`) as a way to keep the hub reserved for system components, so workloads placed here need matching tolerations to actually schedule.

ExternalSecrets in this directory target `external-secrets.io/v1`, since `v1beta1` is deprecated under the ESO 2.5.0 version this cluster runs.

The Atlantis deployment's `--write-git-creds` flag exists because it is what makes GitHub App auth work for Atlantis; removing it breaks that auth path, so it is worth treating as load-bearing rather than incidental.

Before committing a change under `system/<dir>`, it's worth confirming the manifests still render — `kubectl kustomize k8s/system/<dir>` succeeding is the quick signal that the Kustomize tree is still well-formed.

Connectivity into the cluster flows through TargetGroupBinding (TGB) rather than an Ingress controller, with the underlying Target Groups defined in Terraform — so Ingress resources have no role to play here and their absence is by design, not an oversight.
