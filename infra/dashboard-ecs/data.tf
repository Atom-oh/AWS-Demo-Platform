data "aws_caller_identity" "current" {}

locals {
  account_id     = data.aws_caller_identity.current.account_id
  region         = "ap-northeast-2"
  ecr_registry   = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com"
  api_image      = "${local.ecr_registry}/demo-platform/api:main-latest"
  worker_image   = "${local.ecr_registry}/demo-platform/worker:main-latest"
  frontend_image = "${local.ecr_registry}/demo-platform/frontend:main-latest"
  sqs_queue_url  = "https://sqs.${local.region}.amazonaws.com/${local.account_id}/demo-platform-jobs-dev"
}

data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "alb_internal" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/alb-internal/terraform.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "iam" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/iam/terraform.tfstate"
    region = "us-east-1"
  }
}

# Worker-only secrets (full ARNs needed for ECS `secrets`; SM ARNs carry a suffix).
data "aws_secretsmanager_secret" "github_pat" {
  name = "/demo-platform/dev/github/pat"
}
data "aws_secretsmanager_secret" "argocd_token" {
  name = "/demo-platform/argocd/admin-token"
}
