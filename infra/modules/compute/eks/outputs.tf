output "cluster_id" {
  description = "The ID of the EKS cluster"
  value       = aws_eks_cluster.main.id
}

output "cluster_arn" {
  description = "The ARN of the EKS cluster"
  value       = aws_eks_cluster.main.arn
}

output "cluster_endpoint" {
  description = "The endpoint for the EKS cluster API server"
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data for the EKS cluster"
  value       = aws_eks_cluster.main.certificate_authority[0].data
}

output "oidc_provider_arn" {
  description = "The ARN of the OIDC provider for IRSA"
  value       = aws_iam_openid_connect_provider.eks.arn
}

output "oidc_provider_url" {
  description = "The URL of the OIDC provider for IRSA"
  value       = local.oidc_provider_url
}

output "karpenter_role_arn" {
  description = "The ARN of the Karpenter controller IAM role"
  value       = aws_iam_role.karpenter_controller.arn
}

output "service_account_role_arns" {
  description = "Map of service names to their IAM role ARNs"
  value = {
    for service, role in aws_iam_role.service_account : service => role.arn
  }
}

output "bootstrap_node_group_name" {
  description = "The name of the bootstrap node group"
  value       = aws_eks_node_group.bootstrap.node_group_name
}

output "node_group_role_arn" {
  description = "The ARN of the node group IAM role"
  value       = aws_iam_role.node_group.arn
}

output "cluster_security_group_id" {
  description = "The EKS-managed cluster security group ID"
  value       = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
}
