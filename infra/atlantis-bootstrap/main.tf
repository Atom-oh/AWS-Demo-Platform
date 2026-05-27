# Reference existing eks-mgmt cluster state for OIDC provider
data "terraform_remote_state" "eks_mgmt" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/eks-mgmt/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_caller_identity" "current" {}

locals {
  oidc_provider_arn = data.terraform_remote_state.eks_mgmt.outputs.oidc_provider_arn
  oidc_provider_url = data.terraform_remote_state.eks_mgmt.outputs.oidc_provider_url
}

# ─────────────────────────────────────────────────────────────────────
# Atlantis IRSA Role
# ─────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "atlantis_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(local.oidc_provider_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:atlantis:atlantis"]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(local.oidc_provider_url, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "atlantis" {
  name               = "AtlantisIRSARole"
  assume_role_policy = data.aws_iam_policy_document.atlantis_assume.json
}

data "aws_iam_policy_document" "atlantis_perms" {
  statement {
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/DemoPlatformTerraformer"]
  }
  statement {
    # Non-prod platform: broad S3 access. Atlantis needs to manage S3
    # resources across all projects (tfstate buckets + project-owned
    # buckets like tempo-traces, callcenter raw/masked, etc.). Scoping
    # to individual ARNs gets unwieldy fast — single operator, non-prod
    # tolerance applies.
    effect    = "Allow"
    actions   = ["s3:*"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["arn:aws:secretsmanager:ap-northeast-2:${data.aws_caller_identity.current.account_id}:secret:/demo-platform/atlantis/*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "ec2:*", "eks:*", "iam:*", "elasticloadbalancing:*",
      "cloudfront:*", "route53:*", "acm:*",
      "secretsmanager:*", "dynamodb:*", "logs:*",
      "ecr:*", "ecs:*", "cognito-idp:*", "kms:*",
      "rds:Describe*", "elasticache:Describe*", "kafka:Describe*"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "atlantis" {
  name   = "AtlantisPermissions"
  role   = aws_iam_role.atlantis.id
  policy = data.aws_iam_policy_document.atlantis_perms.json
}

# ─────────────────────────────────────────────────────────────────────
# Secrets Manager slots (empty; populated in Task 6)
# ─────────────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "atlantis_github_app_id" {
  name        = "/demo-platform/atlantis/github-app-id"
  description = "Atlantis GitHub App ID"
}
resource "aws_secretsmanager_secret" "atlantis_github_app_installation_id" {
  name        = "/demo-platform/atlantis/github-app-installation-id"
  description = "Atlantis GitHub App Installation ID"
}
resource "aws_secretsmanager_secret" "atlantis_github_app_private_key" {
  name        = "/demo-platform/atlantis/github-app-private-key"
  description = "Atlantis GitHub App private key (PEM)"
}
resource "aws_secretsmanager_secret" "atlantis_github_webhook_secret" {
  name        = "/demo-platform/atlantis/github-webhook-secret"
  description = "Atlantis GitHub webhook signing secret"
}
