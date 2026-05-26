data "terraform_remote_state" "alb_internal" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/alb-internal/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_route53_zone" "public" {
  name         = "atomai.click."
  private_zone = false
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "aws-demo-platform", Component = "cloudfront", ManagedBy = "terraform" }
  }
}

# Use existing *.atomai.click wildcard cert in us-east-1
data "aws_acm_certificate" "cf_wildcard" {
  provider    = aws.us_east_1
  domain      = "*.atomai.click"
  statuses    = ["ISSUED"]
  most_recent = true
}

# VPC Origin (HTTPS-only). DomainName on the distribution drives TLS SNI;
# atlantis.atomai.click matches the *.atomai.click wildcard cert on the ALB.
resource "aws_cloudfront_vpc_origin" "alb" {
  vpc_origin_endpoint_config {
    name                   = "demo-platform-alb-internal"
    arn                    = data.terraform_remote_state.alb_internal.outputs.alb_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"
    origin_ssl_protocols {
      quantity = 1
      items    = ["TLSv1.2"]
    }
  }
}

# Atlantis CF distribution
resource "aws_cloudfront_distribution" "atlantis" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Atlantis (PR-driven Terraform)"
  aliases         = ["atlantis.atomai.click"]
  price_class     = "PriceClass_200"

  origin {
    # DomainName drives Host header CF sends to ALB. atlantis.atomai.click
    # matches the ALB listener rule. Routing still via VPC Origin ENI (HTTP).
    domain_name = "atlantis.atomai.click"
    origin_id   = "alb-internal"
    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.alb.id
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb-internal"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.cf_wildcard.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
