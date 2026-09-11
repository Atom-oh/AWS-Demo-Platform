# k8s/ Module

## Role
Kustomize manifests for hub components and explicitly targeted spoke infrastructure overlays. The owning Application/ApplicationSet determines the destination; the `k8s/system` path does not imply hub-only deployment. Upstream charts are referenced from `argocd-apps/system/`.

## Key Directories
- `system/karpenter-apne2-{mgmt,az-a,az-c}/` — Cluster-specific Karpenter resources. `appset-infra.yaml` maps each path to the matching hub or spoke cluster.
- `system/atlantis/` — Atlantis deployment, service, ServiceAccount (annotated with `AtlantisIRSARole`), ExternalSecret (`v1`), config. The deployment includes `--write-git-creds` for GitHub App auth.
- `system/argocd/` — Helm values file for ArgoCD self-managed install (chart `argo/argo-cd` 9.5.15). `configs.cm` contains the HPA-2 cluster-wide `ignoreDifferences`. Tolerations for `node-role=system-critical`.
- `system/external-secrets-bootstrap/` — One-time bootstrap manifests adopted by ArgoCD (`cluster-secret-store.yaml`, `helm-values.yaml`). Documented in its own README.
- `system/tempo/` — Grafana Tempo 2.7.2 single-binary (S3 backend, IRSA `production-tempo-ap-northeast-2-mgmt`, bucket from `infra/eks-mgmt` `tempo_storage`). Synced to mgmt only via `appset-tempo`. Uses `-config.expand-env=true`; the appset patches `containers[0].env` with literal `AWS_REGION`/`TEMPO_S3_BUCKET` (the in-manifest `tempo-region-config`/`region-config` refs are `optional` and unused).
- `system/clickhouse-mgmt/` — Altinity `ClickHouseInstallation` (otel traces/logs schema, gp3 100Gi, `node-pool=platform`) + 3 internal NLBs (`clickhouse-nlb`/`tempo-nlb`/`prometheus-nlb`) for spoke→hub fan-in. Synced to mgmt only via `appset-clickhouse`; operator via `appset-helm-clickhouse-operator`. The NLBs are a documented no-NLB-convention exception — see ADR-007.
- `system/grafana/` — 11 dashboard ConfigMaps, the `grafana` TargetGroupBinding and an ExternalSecret producing `monitoring/grafana-admin`. The binding resolves `demo-platform-grafana` by name; apply `infra/alb-internal` before merging it. TargetGroupBinding registers Pod IPs from the ClusterIP Service rather than forwarding traffic itself. The Prometheus/Grafana Helm Application consumes the administrator Secret; keep the producer Ready and do not prune it while in use. Public Grafana uses the existing CloudFront distribution and shared VPC Origin; no public LoadBalancer Service is provisioned here.

## Conventions
Read the component's owning Application/ApplicationSet and verify the explicitly selected context matches its destination cluster/account. Hub components use `mall-apne2-mgmt`; the AZ-specific Karpenter overlays use their corresponding spokes. Pass `--context` on cluster operations rather than relying on the shell's default.

Hub nodes carry taints (`workload-type=platform`, `node-role=system-critical`) as a way to keep the hub reserved for system components, so workloads placed here need matching tolerations to actually schedule.

ExternalSecrets in this directory target `external-secrets.io/v1`, since `v1beta1` is deprecated under the ESO 2.5.0 version this cluster runs.

The Atlantis deployment's `--write-git-creds` flag exists because it is what makes GitHub App auth work for Atlantis; removing it breaks that auth path, so it is worth treating as load-bearing rather than incidental.

Before committing a change under `system/<dir>`, it's worth confirming the manifests still render — `kubectl kustomize k8s/system/<dir>` succeeding is the quick signal that the Kustomize tree is still well-formed.

Public traffic reaches the internal ALB's target IPs. TargetGroupBinding (TGB) registers Kubernetes Pod IPs from Service endpoints against Terraform-owned target groups. It is not an additional traffic hop. Ingress resources have no role here; their absence is by design.
