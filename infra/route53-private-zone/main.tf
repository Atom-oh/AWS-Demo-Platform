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

data "terraform_remote_state" "cloudfront" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/cloudfront/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_route53_zone" "public" {
  name         = "atomai.click."
  private_zone = false
}

# Private Hosted Zone (attached to atomoh main VPC)
resource "aws_route53_zone" "private" {
  name = "atomai.click"
  vpc {
    vpc_id = data.terraform_remote_state.shared.outputs.vpc_id
  }
  comment = "Split-horizon DNS — resolves internal services to Internal ALB"
}

# Public records → CloudFront
resource "aws_route53_record" "atlantis_public" {
  zone_id = data.aws_route53_zone.public.zone_id
  name    = "atlantis.atomai.click"
  type    = "A"
  alias {
    name                   = data.terraform_remote_state.cloudfront.outputs.atlantis_cf_domain
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront global HZ
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "argocd_public" {
  zone_id = data.aws_route53_zone.public.zone_id
  name    = "argocd.atomai.click"
  type    = "A"
  alias {
    name                   = data.terraform_remote_state.cloudfront.outputs.argocd_cf_domain
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

# Dashboard API public record → CloudFront (Stage 2 Phase 4)
resource "aws_route53_record" "dashboard_api_public" {
  zone_id = data.aws_route53_zone.public.zone_id
  name    = "admin-api-dev.atomai.click"
  type    = "A"
  alias {
    name                   = data.terraform_remote_state.cloudfront.outputs.dashboard_api_cf_domain
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront global HZ
    evaluate_target_health = false
  }
}

# Private records → Internal ALB (split-horizon)
locals {
  internal_hosts = ["atlantis", "argocd", "admin", "admin-dev", "admin-api-dev"]
}

resource "aws_route53_record" "internal" {
  for_each = toset(local.internal_hosts)
  zone_id  = aws_route53_zone.private.zone_id
  name     = "${each.key}.atomai.click"
  type     = "A"
  alias {
    name                   = data.terraform_remote_state.alb_internal.outputs.alb_dns_name
    zone_id                = data.terraform_remote_state.alb_internal.outputs.alb_zone_id
    evaluate_target_health = true
  }
}
