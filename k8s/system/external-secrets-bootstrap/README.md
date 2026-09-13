# External Secrets Operator

These files remain active inputs for the hub, despite the `bootstrap` directory
name. [`external-secrets.yaml`](../../../argocd-apps/system/external-secrets.yaml)
pins chart 2.5.0 and reads `helm-values.yaml`.
[`cluster-secret-store.yaml`](../../../argocd-apps/system/cluster-secret-store.yaml)
selects only this directory's store manifest. Both Applications use
`prune: false`. The historical proposal to move/delete this directory is not
implemented; deleting it would break these consumers.

- `helm-values.yaml` installs CRDs and applies
  `workload-type=platform:NoSchedule` tolerations to ESO, webhook and certificate
  controller.
- `cluster-secret-store.yaml` defines `external-secrets.io/v1`
  `ClusterSecretStore aws-secrets-manager` in `ap-northeast-2`, using JWT from
  ServiceAccount `external-secrets/external-secrets`.
- The historical `ExternalSecretsIRSARole` and ServiceAccount annotation were
  provisioned out-of-band. This checkout has no Terraform definition or Helm
  annotation for that role. Verify the actual trust/permissions and annotation
  before relying on a fresh install.

For an absent installation, after verifying AWS identity and the
`mall-apne2-mgmt` kube context, run from the repository root:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --kube-context mall-apne2-mgmt -n external-secrets --create-namespace \
  --version 2.5.0 \
  -f k8s/system/external-secrets-bootstrap/helm-values.yaml --wait
kubectl --context mall-apne2-mgmt annotate serviceaccount external-secrets \
  -n external-secrets \
  eks.amazonaws.com/role-arn=arn:aws:iam::180294183052:role/ExternalSecretsIRSARole \
  --overwrite
kubectl --context mall-apne2-mgmt apply \
  -f k8s/system/external-secrets-bootstrap/cluster-secret-store.yaml
kubectl --context mall-apne2-mgmt wait --for=condition=Ready \
  clustersecretstore/aws-secrets-manager --timeout=90s
```

The annotation assumes the verified role already exists; it does not create IAM.
For an existing installation, use its ArgoCD owner and current chart pin. Verify
each consumer ExternalSecret is Ready and synchronized before rolling consumers,
including [Grafana](../../../docs/runbooks/grafana-private-ingress.md).
