terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Environment = var.environment
      Region      = var.region
      ManagedBy   = "terraform"
      Project     = "multi-region-mall"
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Remote State — shared layer (VPC, SGs, data stores)
# ─────────────────────────────────────────────────────────────────────────────

data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Compute — EKS Management Cluster (Multi-AZ: ap-northeast-2a + 2c)
# ─────────────────────────────────────────────────────────────────────────────

module "eks" {
  source = "../modules/compute/eks"

  environment                  = var.environment
  region                       = var.region
  cluster_name                 = "mall-apne2-mgmt"
  vpc_id                       = data.terraform_remote_state.shared.outputs.vpc_id
  private_subnet_ids           = data.terraform_remote_state.shared.outputs.private_subnet_ids
  alb_security_group_id        = data.terraform_remote_state.shared.outputs.alb_security_group_id
  nlb_security_group_id        = data.terraform_remote_state.shared.outputs.nlb_security_group_id
  internal_observability_nlb_security_group_id = data.terraform_remote_state.shared.outputs.internal_observability_nlb_security_group_id
  bootstrap_node_instance_types = ["m5.xlarge", "m5a.xlarge"]
  role_name_suffix             = "-apne2-mgmt"
  tags                         = var.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# Compute — ALB Controller IRSA
# ─────────────────────────────────────────────────────────────────────────────

module "alb" {
  source = "../modules/compute/alb"

  environment       = var.environment
  cluster_name      = "mall-apne2-mgmt"
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  vpc_id            = data.terraform_remote_state.shared.outputs.vpc_id
  role_name_suffix  = "-apne2-mgmt"
  tags              = var.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# Observability — OTel Collector IRSA (management cluster self-monitoring)
# ─────────────────────────────────────────────────────────────────────────────

module "otel_collector_irsa" {
  source = "../modules/observability/otel-collector-irsa"

  environment       = var.environment
  region            = var.region
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  name_suffix       = "-mgmt"
  tags              = var.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# Observability — Tempo storage (S3 + IRSA) — centralized for Korea
# ─────────────────────────────────────────────────────────────────────────────

module "tempo_storage" {
  source = "../modules/observability/tempo-storage"

  environment       = var.environment
  region            = var.region
  kms_key_arn       = data.terraform_remote_state.shared.outputs.kms_key_arns["s3"]
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  name_suffix       = "-mgmt"
  tags              = var.tags
}

# ─────────────────────────────────────────────────────────────────────────────
# CI Runner — Pod Identity for GitHub Actions self-hosted runners
# Grants ECR push, Bedrock invoke, and AgentCore access to all runner pods.
# ─────────────────────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "ci_runner" {
  name = "mall-apne2-mgmt-ci-runner"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "pods.eks.amazonaws.com"
      }
      Action = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })

  tags = merge(var.tags, { Name = "mall-apne2-mgmt-ci-runner" })
}

resource "aws_iam_role_policy" "ci_runner_ecr" {
  name = "ecr-push"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:CreateRepository",
          "ecr:DescribeRepositories"
        ]
        Resource = "arn:aws:ecr:${var.region}:${data.aws_caller_identity.current.account_id}:repository/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ci_runner_bedrock" {
  name = "bedrock-invoke"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
          "bedrock:GetFoundationModel",
          "bedrock:ListFoundationModels",
          "bedrock:GetInferenceProfile",
          "bedrock:ListInferenceProfiles"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:*",
          "bedrock-agentcore-control:*"
        ]
        Resource = "*"
      },
      {
        # bedrock-mantle 은 bedrock 과 별개 IAM 서비스. codex 의 openai.gpt-5.5
        # (bedrock-mantle Responses API, us-east-1 In-Region)는 bedrock-mantle:CreateInference
        # 가 필요하다 — bedrock:InvokeModel 로는 안 됨(401 Unauthorized).
        Effect   = "Allow"
        Action   = ["bedrock-mantle:*"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*agentcore*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/cdk-*"
        ]
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ci_runner_readonly" {
  role       = aws_iam_role.ci_runner.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy_attachment" "ci_runner_s3_full" {
  role       = aws_iam_role.ci_runner.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_iam_role_policy" "ci_runner_cloudfront" {
  name = "cloudfront-invalidation"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:ListInvalidations",
        "cloudfront:GetDistribution"
      ]
      Resource = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
    }]
  })
}

resource "aws_iam_role_policy" "ci_runner_ecs" {
  name = "ecs-deploy"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTaskDefinitions",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeClusters",
          "ecs:ListServices"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ci_runner_cdk_deploy" {
  name = "cdk-deploy"
  role = aws_iam_role.ci_runner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CDKBootstrapSSM"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:*:${data.aws_caller_identity.current.account_id}:parameter/cdk-bootstrap/*"
      },
      {
        Sid    = "CDKAssumeRoles"
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/cdk-*"
        ]
      },
      {
        Sid    = "CloudFormation"
        Effect = "Allow"
        Action = [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:DeleteChangeSet",
          "cloudformation:DescribeStackEvents"
        ]
        Resource = "arn:aws:cloudformation:*:${data.aws_caller_identity.current.account_id}:stack/*/*"
      },
      {
        Sid    = "S3CDKAssets"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          "arn:aws:s3:::cdk-*",
          "arn:aws:s3:::cdk-*/*"
        ]
      }
    ]
  })
}

# Pod Identity Associations — one per runner service account
locals {
  runner_service_accounts = [
    "ttobak-x86-gha-rs-no-permission",
    "ttobak-arm-gha-rs-no-permission",
    "cc-bedrock-x86-gha-rs-no-permission",
    "cc-bedrock-arm-gha-rs-no-permission",
    "aws-fsi-demo-x86-gha-rs-no-permission",
    "aws-fsi-demo-arm-gha-rs-no-permission",
    "awsops-x86-gha-rs-no-permission",
    "awsops-arm-gha-rs-no-permission",
    "self-hosted-x86-gha-rs-no-permission",
    "self-hosted-arm-gha-rs-no-permission",
  ]
}

resource "aws_eks_pod_identity_association" "ci_runner" {
  for_each = toset(local.runner_service_accounts)

  cluster_name    = "mall-apne2-mgmt"
  namespace       = "actions-runner-system"
  service_account = each.value
  role_arn        = aws_iam_role.ci_runner.arn

  tags = merge(var.tags, { Name = "ci-runner-${each.value}" })

  depends_on = [module.eks]
}
