# Hub EKS

Authoritative Terraform for `mall-apne2-mgmt`, its controller/observability
identities and shared CI runner Pod Identity role. Preserve the adopted `mall-*`
names and state key; the new-resource prefix convention is not a rename mandate.
The duplicate root in `multi-region-architecture` was removed; this repository's
Atlantis owns applies.

- Bucket: `multi-region-mall-terraform-state` in `us-east-1`.
- Key: `production/ap-northeast-2/eks-mgmt/terraform.tfstate`.
- Lock table: `multi-region-mall-terraform-locks`; Terraform 1.9.6.
- Shared VPC/subnets/SGs come from the Korea `shared/` remote state. Spoke consumers
  use this hub state's `cluster_security_group_id`; coordinate output changes.

## Source map

- `main.tf` calls `../modules/compute/eks` for the cluster, bootstrap node group,
  IRSA/OIDC and Karpenter identity. Declared add-ons are VPC CNI, CoreDNS,
  kube-proxy, EBS CSI and Pod Identity Agent; EFS CSI is not declared here.
- `module.alb` owns AWS Load Balancer Controller IRSA, not the platform's internal
  ALB. That ALB belongs to `../alb-internal`.
- `otel_collector_irsa` and `tempo_storage` own observability IRSA and Tempo S3.
- Inline `ci_runner` IAM is shared across the explicitly listed service accounts.
  It includes ECR, Bedrock/bedrock-mantle, S3, ECS/CDK and AMI-build permissions.
  Some AMI destructive/SSM actions are tag-scoped; this is not a claim that every
  action in the shared role is narrowly scoped. Inspect the actual statements.
- `outputs.tf` exports cluster/SG, OIDC, controller roles and Tempo storage.
  `acm_certificate_arn` remains a declared input but is not consumed by `main.tf`;
  its placeholder in `terraform.tfvars` is not the deployed ALB certificate.

Bootstrap nodes use label `role=system` and taint
`node-role=system-critical:NoSchedule`. Karpenter platform/runner pools have
different selectors and taints; see the [Kubernetes guide](../../k8s/CLAUDE.md).
The hub intentionally combines x86 bootstrap/runner capacity with ARM64 pools.

Review `atlantis plan -d infra/eks-mgmt` before
`atlantis apply -d infra/eks-mgmt`. Apply new shared-state outputs before planning
this consumer. Verify the intended kube context/account before runtime checks;
Terraform configuration alone does not prove cluster health.
