# infra/eks-mgmt

## Role
**Authoritative** Terraform for the hub EKS cluster `mall-apne2-mgmt` and the IAM that
hangs off it (ALB controller, OTel/Tempo IRSA, Karpenter, and the shared CI runner role
used by the PR-review / AMI-build self-hosted runners via EKS Pod Identity).

This used to be a duplicate of the same dir in `multi-region-architecture`; that copy was
removed (2026-06-24) and this repo is now the single owner. Apply **only** via this repo's
Atlantis — never apply the same state from two places (split-brain).

## State
- **Bucket** `multi-region-mall-terraform-state` (shared, us-east-1)
- **Key** `production/ap-northeast-2/eks-mgmt/terraform.tfstate`
- **Lock table** `multi-region-mall-terraform-locks`
- ⚠️ **Do NOT rename the key.** The spokes `eks-az-a` / `eks-az-c` in
  `multi-region-architecture` read this state read-only via `terraform_remote_state`
  (they consume `cluster_security_group_id`). Renaming the key breaks their plan/apply.

## Composition (`main.tf`)
- `module "eks"` (`../modules/compute/eks`) — cluster `mall-apne2-mgmt`, addons
  (vpc-cni, coredns, kube-proxy, ebs-csi, **efs-csi v2.3.0-eksbuild.2**, pod-identity-agent),
  Karpenter + node-group IAM, IRSA OIDC. VPC/subnets/SGs come from the `shared` remote state.
- `module "alb"` — AWS Load Balancer Controller IRSA.
- `module "otel_collector_irsa"`, `module "tempo_storage"` — observability IRSA + Tempo S3.
- Inline IAM: `DemoPlatformTerraformer`-adjacent deployer perms + `ci_runner` role
  (Bedrock, **bedrock-mantle**, AMI-build EC2/SSM scoped to `managed_by=cc-on-bedrock`).

## Key outputs (consumed cross-repo — keep stable)
`cluster_security_group_id` (← az-a/az-c), `oidc_provider_arn/url`, `cluster_endpoint`,
`service_account_role_arns`, `karpenter_role_arn`, `tempo_role_arn`, `tempo_s3_bucket`.

## Inputs
`environment`, `region`, `acm_certificate_arn`, `tags` (see `terraform.tfvars`).

## Apply
```
atlantis plan -d infra/eks-mgmt
atlantis apply -d infra/eks-mgmt
```
