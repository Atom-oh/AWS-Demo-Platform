# ArgoCD on hub cluster

Fresh ArgoCD installation replacing the previous `argocd-korea` setup
(in `multi-region-architecture/k8s/infra/argocd-korea/`).

## Differences from upstream argocd-korea

| Item | argocd-korea | Here |
|---|---|---|
| Domain | argocd-kr.atomai.click | argocd.atomai.click |
| Exposure | NLB (Service type LoadBalancer) | TGB → Internal ALB → CF |
| Replicas | 2× server/controller/repoServer | 1× each (non-prod) |
| Redis HA | enabled | disabled (single redis OK for non-prod) |
| AppSets | many region-specific in `apps/` | none here — tenants register via `argocd-apps/tenants/` |
| ignoreDifferences | not configured | **Deployment/StatefulSet `/spec/replicas`, HPA `/spec/minReplicas`+`/spec/maxReplicas`** (HPA-2 pattern, spec §4.2) |

## How it was installed (Stage 1 Phase D)

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  -n argocd --create-namespace \
  --version 7.8.13 \
  -f values.yaml \
  --wait
```

## Bootstrap Application CRs (one-time)

After helm install, these master-roots are applied directly (they then sync
themselves and all tenants/system components):

- `argocd-apps/bootstrap/master-system-root.yaml` — watches `argocd-apps/system/`
- `argocd-apps/bootstrap/master-tenants-root.yaml` — watches `argocd-apps/tenants/`

Once these are running, every future change (adding system components,
registering new tenant projects) is a PR merging YAML into the respective
directories. No manual `kubectl apply` after this.

## Admin access

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
# Login: argocd login argocd.atomai.click --username admin --password <above>
```

API token for dashboard backend (Stage 3) is generated and stored in
AWS Secrets Manager at `/demo-platform/argocd/admin-token`.
