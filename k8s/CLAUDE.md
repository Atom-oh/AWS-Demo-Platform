# k8s/ Module

## Role
Kustomize manifests for hub cluster (`mall-apne2-mgmt`) system components. Repo-owned manifests live here; upstream third-party charts (ArgoCD, ESO) are referenced from `argocd-apps/system/` instead.

## Key Directories
- `system/atlantis/` — Atlantis deployment, service, ServiceAccount (annotated with `AtlantisIRSARole`), ExternalSecret (`v1`), config. The deployment includes `--write-git-creds` for GitHub App auth.
- `system/argocd/` — Helm values file for ArgoCD self-managed install (chart `argo/argo-cd` 9.5.15). `configs.cm` contains the HPA-2 cluster-wide `ignoreDifferences`. Tolerations for `node-role=system-critical`.
- `system/external-secrets-bootstrap/` — One-time bootstrap manifests adopted by ArgoCD (`cluster-secret-store.yaml`, `helm-values.yaml`). Documented in its own README.

## Rules
- **kube context** — always run `kubectl config current-context` and confirm `mall-apne2-mgmt` before any cluster op. Spoke workloads are NOT managed here.
- **Tolerations required** — hub nodes have taints (`workload-type=platform`, `node-role=system-critical`). All workloads here must tolerate them.
- **ExternalSecret API version** — use `external-secrets.io/v1`. `v1beta1` is deprecated in ESO 2.5.0.
- **Atlantis `--write-git-creds`** — required flag for GitHub App auth. Do not strip.
- **Validate before commit** — `kubectl kustomize k8s/system/<dir>` must succeed.
- **No Ingress resources** — connectivity is via TargetGroupBinding (TGB), TGs are in Terraform.
