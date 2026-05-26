terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.35"
}

variable "vpc_id" {
  description = "VPC ID where the EKS cluster will be deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for the EKS cluster"
  type        = list(string)
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "role_name_suffix" {
  description = "Suffix for IAM role names. Defaults to '-{region}'. Set to empty string for roles without region suffix."
  type        = string
  default     = null
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB, used to allow ingress from ALB to EKS cluster SG"
  type        = string
  default     = ""
}

variable "nlb_security_group_id" {
  description = "Security group ID of the NLB, used to allow ingress from NLB to EKS cluster SG on port 8080 (ArgoCD)"
  type        = string
  default     = ""
}

variable "argocd_security_group_id" {
  description = "Security group ID of the ArgoCD management cluster (for cross-cluster API access on port 443)"
  type        = string
  default     = ""
}

variable "internal_observability_nlb_security_group_id" {
  description = "Security group ID of the internal observability NLB (ClickHouse, Tempo, Prometheus)"
  type        = string
  default     = ""
}

variable "bootstrap_node_instance_types" {
  description = "Instance types for bootstrap node group"
  type        = list(string)
  default     = ["m5.large", "m5a.large"]
}

variable "bootstrap_node_desired_size" {
  description = "Desired number of bootstrap nodes"
  type        = number
  default     = 2
}

variable "bootstrap_node_min_size" {
  description = "Minimum number of bootstrap nodes"
  type        = number
  default     = 2
}

variable "bootstrap_node_max_size" {
  description = "Maximum number of bootstrap nodes"
  type        = number
  default     = 3
}

variable "addon_versions" {
  description = "EKS addon versions. Defaults are latest for EKS 1.35."
  type = object({
    vpc_cni                = string
    coredns                = string
    kube_proxy             = string
    ebs_csi_driver         = string
    efs_csi_driver         = string
    eks_pod_identity_agent = string
  })
  default = {
    vpc_cni                = "v1.21.1-eksbuild.3"
    coredns                = "v1.13.2-eksbuild.3"
    kube_proxy             = "v1.35.0-eksbuild.2"
    ebs_csi_driver         = "v1.56.0-eksbuild.1"
    efs_csi_driver         = "v2.3.0-eksbuild.2"
    eks_pod_identity_agent = "v1.3.7-eksbuild.2"
  }
}

variable "enabled_cluster_log_types" {
  description = "EKS control plane log types to enable (e.g., api, authenticator, audit, scheduler, controllerManager). Empty list disables all."
  type        = list(string)
  default     = []
}
