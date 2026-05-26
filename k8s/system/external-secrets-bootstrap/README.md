# External Secrets Operator — Bootstrap Manifests

Bootstrap files for ESO on `mall-apne2-mgmt` hub cluster during Stage 1.

**Per spec**, ESO is a shared agent that should live in `multi-region-architecture/k8s/infra/external-secrets/` and be deployed via the tenant App-of-Apps (Task 19 in the Stage 1 plan).

These bootstrap files were applied directly via `kubectl` / `helm` during Stage 1 because Atlantis and ArgoCD weren't yet operational. **They will be migrated to multi-region-architecture in Task 19**, after which this directory is removed.

## What's here

- `helm-values.yaml` — helm chart values with `workload-type=platform` tolerations
- `cluster-secret-store.yaml` — `ClusterSecretStore` named `aws-secrets-manager` using IRSA via `ExternalSecretsIRSARole`

## How it was installed (Stage 1 Task 7 bootstrap)

```bash
# 1. Install ESO
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace \
  -f helm-values.yaml --wait

# 2. IRSA role created via AWS CLI (out of band — to be migrated to Terraform)
#    Role: ExternalSecretsIRSARole
#    Trust: oidc.eks.ap-northeast-2.../sub: system:serviceaccount:external-secrets:external-secrets
#    Perms: secretsmanager:GetSecretValue|DescribeSecret|ListSecrets on /demo-platform/*

# 3. Annotate SA
kubectl annotate serviceaccount external-secrets -n external-secrets \
  eks.amazonaws.com/role-arn=arn:aws:iam::180294183052:role/ExternalSecretsIRSARole --overwrite

# 4. Create ClusterSecretStore
kubectl apply -f cluster-secret-store.yaml
```

## TODO (Stage 1 Task 19)

- [ ] Move helm-values.yaml + cluster-secret-store.yaml to `multi-region-architecture/k8s/infra/external-secrets/`
- [ ] Move `ExternalSecretsIRSARole` definition to Terraform (e.g., `infra/iam/external-secrets-irsa.tf`)
- [ ] Register as ArgoCD Application (shared-agents-hub.yaml)
- [ ] Delete this directory
