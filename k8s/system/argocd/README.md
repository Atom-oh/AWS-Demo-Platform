# ArgoCD on the hub

[`argocd-apps/system/argocd.yaml`](../../../argocd-apps/system/argocd.yaml)
self-manages Helm release `argocd` on `mall-apne2-mgmt`, currently pinning chart
9.5.15 and this directory's `values.yaml`. It uses one replica per main component,
single Redis, `role=system` selection and the
`node-role=system-critical:NoSchedule` toleration. This non-production sizing is
intentional.

Public traffic is CloudFront → VPC Origin → internal ALB → server Pod IPs.
`tgb.yaml` registers the ClusterIP Service's endpoints; it is not a traffic hop.
The server's `--insecure` setting is internal HTTP behind ALB TLS termination,
not permission to disable client TLS verification.

`configs.cm` ignores Deployment/StatefulSet replicas and HPA min/max for lifecycle
control. Preserve those rules. Source and sync-policy details belong in the
[Application guide](../../../argocd-apps/CLAUDE.md).

## Initial bootstrap or controlled recovery

From the repository root, first verify the explicit context's account and cluster:

```bash
aws sts get-caller-identity
kubectl --context mall-apne2-mgmt config view --minify
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  --kube-context mall-apne2-mgmt -n argocd --create-namespace \
  --version 9.5.15 -f k8s/system/argocd/values.yaml --wait
kubectl --context mall-apne2-mgmt apply \
  -f argocd-apps/bootstrap/master-system-root.yaml \
  -f argocd-apps/bootstrap/master-tenants-root.yaml
```

The install command is for an absent release; reconcile an existing installation
through its owner. Recheck the chart pin before recovery. The bootstrap roots watch
`system/` and `tenants/`; they do not watch their own `bootstrap/` directory.

`tgb.yaml` is a separate bootstrap manifest, not selected by the current Helm
Application. Verify its recorded target-group ARN against `infra/alb-internal`
before a reviewed initial apply:

```bash
kubectl --context mall-apne2-mgmt apply -f k8s/system/argocd/tgb.yaml
```

Normal managed component changes use PRs and ArgoCD reconciliation. Do not assume
every file in this directory is automatically applied.

## Access

Verify public TLS, then use `argocd login argocd.atomai.click --username admin`
with an interactive password prompt. Obtain bootstrap credentials only through a
protected operator session; do not print decoded Secrets into shared logs.
`accounts.admin: apiKey` permits the worker token stored at
`/demo-platform/argocd/admin-token`. A dedicated non-admin token identity is not
implemented by these values.
