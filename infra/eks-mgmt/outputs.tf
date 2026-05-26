# ─────────────────────────────────────────────────────────────────────────────
# EKS
# ─────────────────────────────────────────────────────────────────────────────

output "cluster_name" {
  description = "The name of the EKS management cluster"
  value       = module.eks.cluster_id
}

output "cluster_endpoint" {
  description = "The endpoint for the EKS cluster API server"
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data for the EKS cluster"
  value       = module.eks.cluster_certificate_authority_data
}

output "oidc_provider_arn" {
  description = "The ARN of the OIDC provider for IRSA"
  value       = module.eks.oidc_provider_arn
}

output "oidc_provider_url" {
  description = "The URL of the OIDC provider for IRSA"
  value       = module.eks.oidc_provider_url
}

output "karpenter_role_arn" {
  description = "The ARN of the Karpenter controller IAM role"
  value       = module.eks.karpenter_role_arn
}

output "service_account_role_arns" {
  description = "Map of service names to their IAM role ARNs"
  value       = module.eks.service_account_role_arns
}

output "node_group_role_arn" {
  description = "The ARN of the node group IAM role"
  value       = module.eks.node_group_role_arn
}

output "cluster_security_group_id" {
  description = "The EKS-managed cluster security group ID (used for cross-cluster ArgoCD access)"
  value       = module.eks.cluster_security_group_id
}

# ─────────────────────────────────────────────────────────────────────────────
# ALB
# ─────────────────────────────────────────────────────────────────────────────

output "alb_controller_role_arn" {
  description = "The ARN of the IAM role for AWS Load Balancer Controller"
  value       = module.alb.alb_controller_role_arn
}

# ─────────────────────────────────────────────────────────────────────────────
# Observability
# ─────────────────────────────────────────────────────────────────────────────

output "otel_collector_role_arn" {
  description = "The ARN of the OTel Collector IAM role"
  value       = module.otel_collector_irsa.otel_collector_role_arn
}

output "tempo_role_arn" {
  description = "The ARN of the Tempo IAM role"
  value       = module.tempo_storage.tempo_role_arn
}

output "tempo_s3_bucket" {
  description = "The name of the Tempo S3 bucket"
  value       = module.tempo_storage.bucket_name
}
