data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  services = {
    "product-catalog" = { namespace = "core-services", policies = ["AmazonDocDBFullAccess"] }
    "search"          = { namespace = "core-services", policies = [] }
    "cart"            = { namespace = "core-services", policies = [] }
    "order"           = { namespace = "core-services", policies = ["AmazonRDSDataFullAccess"] }
    "payment"         = { namespace = "core-services", policies = ["AmazonRDSDataFullAccess"] }
    "inventory"       = { namespace = "core-services", policies = ["AmazonRDSDataFullAccess"] }
    "user-account"    = { namespace = "user-services", policies = ["AmazonRDSDataFullAccess"] }
    "user-profile"    = { namespace = "user-services", policies = ["AmazonDocDBFullAccess"] }
    "wishlist"        = { namespace = "user-services", policies = ["AmazonDocDBFullAccess"] }
    "review"          = { namespace = "user-services", policies = ["AmazonDocDBFullAccess"] }
    "shipping"        = { namespace = "fulfillment", policies = ["AmazonDocDBFullAccess"] }
    "warehouse"       = { namespace = "fulfillment", policies = ["AmazonRDSDataFullAccess"] }
    "returns"         = { namespace = "fulfillment", policies = ["AmazonRDSDataFullAccess"] }
    "pricing"         = { namespace = "business-services", policies = ["AmazonRDSDataFullAccess"] }
    "recommendation"  = { namespace = "business-services", policies = ["AmazonDocDBFullAccess"] }
    "notification"    = { namespace = "business-services", policies = [] }
    "seller"          = { namespace = "business-services", policies = ["AmazonRDSDataFullAccess"] }
    "api-gateway"     = { namespace = "platform", policies = [] }
    "event-bus"       = { namespace = "platform", policies = [] }
    "analytics"       = { namespace = "platform", policies = ["AmazonS3FullAccess"] }
  }

  oidc_provider_url = replace(aws_eks_cluster.main.identity[0].oidc[0].issuer, "https://", "")
  role_name_suffix  = var.role_name_suffix != null ? var.role_name_suffix : "-${var.region}"
}

# KMS key for EKS secrets encryption
resource "aws_kms_key" "eks_secrets" {
  description             = "KMS key for EKS secrets encryption - ${var.cluster_name}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "${var.cluster_name}-eks-secrets"
  })
}

resource "aws_kms_alias" "eks_secrets" {
  name          = "alias/${var.cluster_name}-eks-secrets"
  target_key_id = aws_kms_key.eks_secrets.key_id
}

# IAM role for EKS cluster
resource "aws_iam_role" "eks_cluster" {
  name = "${var.cluster_name}-cluster-role${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

resource "aws_iam_role_policy_attachment" "eks_vpc_resource_controller" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSVPCResourceController"
  role       = aws_iam_role.eks_cluster.name
}

# Pre-create CloudWatch log group with retention before EKS creates it (prevents Never Expire)
resource "aws_cloudwatch_log_group" "eks_cluster" {
  count             = length(var.enabled_cluster_log_types) > 0 ? 1 : 0
  name              = "/aws/eks/${var.cluster_name}/cluster"
  retention_in_days = 7

  tags = merge(var.tags, {
    Name = "/aws/eks/${var.cluster_name}/cluster"
  })
}

# EKS Cluster
resource "aws_eks_cluster" "main" {
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = aws_iam_role.eks_cluster.arn

  kubernetes_network_config {
    service_ipv4_cidr = "172.20.0.0/16"
  }

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  enabled_cluster_log_types = var.enabled_cluster_log_types

  encryption_config {
    provider {
      key_arn = aws_kms_key.eks_secrets.arn
    }
    resources = ["secrets"]
  }

  access_config {
    authentication_mode = "API_AND_CONFIG_MAP"
  }

  tags = merge(var.tags, {
    Name = var.cluster_name
  })

  lifecycle {
    ignore_changes = [
      access_config[0].bootstrap_cluster_creator_admin_permissions
    ]
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
    aws_iam_role_policy_attachment.eks_vpc_resource_controller
  ]
}

# Tag EKS-managed cluster SG for Karpenter discovery
resource "aws_ec2_tag" "cluster_sg_karpenter_discovery" {
  resource_id = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  key         = "karpenter.sh/discovery"
  value       = var.cluster_name
}

# Allow ALB to reach pods on port 80 via the EKS-managed cluster security group
resource "aws_security_group_rule" "eks_cluster_sg_alb_ingress" {
  count = var.alb_security_group_id != "" ? 1 : 0

  type                     = "ingress"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  source_security_group_id = var.alb_security_group_id
  description              = "Allow HTTP from ALB to EKS nodes"
}

# Allow all traffic from NLB to EKS nodes (ArgoCD 8080, Grafana 3000, api-gateway 80, etc.)
resource "aws_security_group_rule" "eks_cluster_sg_nlb_ingress" {
  count = var.nlb_security_group_id != "" ? 1 : 0

  type                     = "ingress"
  from_port                = 0
  to_port                  = 0
  protocol                 = "-1"
  security_group_id        = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  source_security_group_id = var.nlb_security_group_id
  description              = "All traffic from NLB to EKS nodes"
}

# Allow ArgoCD management cluster to access EKS API (cross-cluster management)
resource "aws_security_group_rule" "eks_cluster_sg_argocd_ingress" {
  count = var.argocd_security_group_id != "" ? 1 : 0

  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  source_security_group_id = var.argocd_security_group_id
  description              = "Allow HTTPS from ArgoCD mgmt cluster to EKS API"
}

# Allow internal observability NLBs to reach pods (ClickHouse 9000/8123, Tempo 4317/3200, Prometheus 9090)
resource "aws_security_group_rule" "eks_cluster_sg_internal_obs_nlb_ingress" {
  count = var.internal_observability_nlb_security_group_id != "" ? 1 : 0

  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  security_group_id        = aws_eks_cluster.main.vpc_config[0].cluster_security_group_id
  source_security_group_id = var.internal_observability_nlb_security_group_id
  description              = "All TCP from internal observability NLBs (ClickHouse, Tempo, Prometheus)"
}

# OIDC Provider for IRSA
data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer

  tags = merge(var.tags, {
    Name = "${var.cluster_name}-oidc-provider"
  })
}

# IAM role for VPC CNI addon
resource "aws_iam_role" "vpc_cni" {
  name = "${var.cluster_name}-vpc-cni${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${local.oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_provider_url}:sub" = "system:serviceaccount:kube-system:aws-node"
          }
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "vpc_cni" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.vpc_cni.name
}

# IAM role for EBS CSI Driver addon
resource "aws_iam_role" "ebs_csi" {
  name = "${var.cluster_name}-ebs-csi${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${local.oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_provider_url}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
          }
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi.name
}

# EKS Addons
resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  addon_version               = var.addon_versions.vpc_cni
  resolve_conflicts_on_update = "OVERWRITE"
  service_account_role_arn    = aws_iam_role.vpc_cni.arn

  # Note: ENABLE_NETWORK_POLICY removed - not supported in this VPC-CNI version

  tags = var.tags

  depends_on = [aws_iam_role_policy_attachment.vpc_cni]
}

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "coredns"
  addon_version               = var.addon_versions.coredns
  resolve_conflicts_on_update = "OVERWRITE"

  configuration_values = jsonencode({
    tolerations = [
      {
        key    = "node-role"
        value  = "system-critical"
        effect = "NoSchedule"
      }
    ]
    nodeSelector = {
      role = "system"
    }
    affinity = {
      podAntiAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution = [
          {
            labelSelector = {
              matchExpressions = [
                {
                  key      = "k8s-app"
                  operator = "In"
                  values   = ["kube-dns"]
                }
              ]
            }
            topologyKey = "kubernetes.io/hostname"
          }
        ]
      }
    }
  })

  tags = var.tags

  depends_on = [aws_eks_addon.vpc_cni]
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "kube-proxy"
  addon_version               = var.addon_versions.kube_proxy
  resolve_conflicts_on_update = "OVERWRITE"

  tags = var.tags
}

resource "aws_eks_addon" "aws_ebs_csi_driver" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "aws-ebs-csi-driver"
  addon_version               = var.addon_versions.ebs_csi_driver
  resolve_conflicts_on_update = "OVERWRITE"
  service_account_role_arn    = aws_iam_role.ebs_csi.arn

  configuration_values = jsonencode({
    controller = {
      tolerations = [
        {
          key      = "node-role"
          operator = "Equal"
          value    = "system-critical"
          effect   = "NoSchedule"
        }
      ]
    }
  })

  tags = var.tags

  depends_on = [aws_eks_addon.vpc_cni, aws_iam_role_policy_attachment.ebs_csi]
}

resource "aws_eks_addon" "eks_pod_identity_agent" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "eks-pod-identity-agent"
  addon_version               = var.addon_versions.eks_pod_identity_agent
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_addon.vpc_cni]
}

# Bootstrap node group IAM role
resource "aws_iam_role" "node_group" {
  name = "${var.cluster_name}-node-group${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "node_group_worker" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_group_cni" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_group_ecr" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_group_ssm" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_group_ebs_csi" {
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.node_group.name
}

# Bootstrap managed node group
resource "aws_launch_template" "bootstrap" {
  name_prefix = "${var.cluster_name}-bootstrap-"

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size = 20
      volume_type = "gp3"
      encrypted   = true
    }
  }

  tags = merge(var.tags, {
    Name = "${var.cluster_name}-bootstrap-lt"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_eks_node_group" "bootstrap" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-bootstrap"
  node_role_arn   = aws_iam_role.node_group.arn
  subnet_ids      = var.private_subnet_ids

  instance_types = var.bootstrap_node_instance_types

  launch_template {
    id      = aws_launch_template.bootstrap.id
    version = aws_launch_template.bootstrap.latest_version
  }

  scaling_config {
    desired_size = var.bootstrap_node_desired_size
    min_size     = var.bootstrap_node_min_size
    max_size     = var.bootstrap_node_max_size
  }

  labels = {
    role = "system"
  }

  taint {
    key    = "node-role"
    value  = "system-critical"
    effect = "NO_SCHEDULE"
  }

  tags = merge(var.tags, {
    Name = "${var.cluster_name}-bootstrap-node"
  })

  depends_on = [
    aws_iam_role_policy_attachment.node_group_worker,
    aws_iam_role_policy_attachment.node_group_cni,
    aws_iam_role_policy_attachment.node_group_ecr,
    aws_iam_role_policy_attachment.node_group_ssm,
    aws_iam_role_policy_attachment.node_group_ebs_csi
  ]
}

# Karpenter IAM Role
resource "aws_iam_role" "karpenter_controller" {
  name = "${var.cluster_name}-karpenter-controller${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${local.oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_provider_url}:sub" = "system:serviceaccount:karpenter:karpenter"
          }
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "karpenter_controller" {
  name = "${var.cluster_name}-karpenter-controller-policy${local.role_name_suffix}"
  role = aws_iam_role.karpenter_controller.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Karpenter"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ec2:DescribeImages",
          "ec2:RunInstances",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeLaunchTemplates",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeInstanceTypeOfferings",
          "ec2:DescribeAvailabilityZones",
          "ec2:DeleteLaunchTemplate",
          "ec2:CreateTags",
          "ec2:CreateLaunchTemplate",
          "ec2:CreateFleet",
          "ec2:DescribeSpotPriceHistory",
          "pricing:GetProducts"
        ]
        Resource = "*"
      },
      {
        Sid      = "ConditionalEC2Termination"
        Effect   = "Allow"
        Action   = "ec2:TerminateInstances"
        Resource = "*"
        Condition = {
          StringLike = {
            "ec2:ResourceTag/karpenter.sh/nodepool" = "*"
          }
        }
      },
      {
        Sid      = "PassNodeIAMRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ec2.amazonaws.com"
          }
        }
      },
      {
        Sid      = "EKSClusterEndpointLookup"
        Effect   = "Allow"
        Action   = "eks:DescribeCluster"
        Resource = aws_eks_cluster.main.arn
      },
      {
        Sid    = "KarpenterInstanceProfiles"
        Effect = "Allow"
        Action = [
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:GetInstanceProfile",
          "iam:ListInstanceProfiles",
          "iam:TagInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile"
        ]
        Resource = "*"
      },
      {
        Sid    = "KarpenterSQS"
        Effect = "Allow"
        Action = [
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage"
        ]
        Resource = "arn:${data.aws_partition.current.partition}:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:${var.cluster_name}-karpenter"
      }
    ]
  })
}

# IRSA roles for services
resource "aws_iam_role" "service_account" {
  for_each = local.services

  name = "${var.cluster_name}-${each.key}-sa${local.role_name_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks.arn
        }
        Condition = {
          StringEquals = {
            "${local.oidc_provider_url}:aud" = "sts.amazonaws.com"
            "${local.oidc_provider_url}:sub" = "system:serviceaccount:${each.value.namespace}:${each.key}"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Service   = each.key
    Namespace = each.value.namespace
  })
}

# Attach SecretsManagerReadWrite to all service accounts
resource "aws_iam_role_policy_attachment" "service_account_secrets_manager" {
  for_each = local.services

  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/SecretsManagerReadWrite"
  role       = aws_iam_role.service_account[each.key].name
}

# Attach XRay write access to all service accounts
resource "aws_iam_role_policy_attachment" "service_account_xray" {
  for_each = local.services

  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSXRayDaemonWriteAccess"
  role       = aws_iam_role.service_account[each.key].name
}

# Attach service-specific policies
locals {
  service_policy_attachments = flatten([
    for service, config in local.services : [
      for policy in config.policies : {
        service = service
        policy  = policy
      }
    ]
  ])
}

resource "aws_iam_role_policy_attachment" "service_account_specific" {
  for_each = {
    for sp in local.service_policy_attachments : "${sp.service}-${sp.policy}" => sp
  }

  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.value.policy}"
  role       = aws_iam_role.service_account[each.value.service].name
}
