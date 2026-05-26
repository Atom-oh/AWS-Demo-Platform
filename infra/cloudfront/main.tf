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

# Cert for CF (must be in us-east-1)
resource "aws_acm_certificate" "cf" {
  provider                  = aws.us_east_1
  domain_name               = "atomai.click"
  subject_alternative_names = ["*.atomai.click"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cf_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cf.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.public.zone_id
}

resource "aws_acm_certificate_validation" "cf" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cf.arn
  validation_record_fqdns = [for r in aws_route53_record.cf_cert_validation : r.fqdn]
}

# VPC Origin — HTTP-only variant (avoids TLS SNI mismatch with ALB AWS DNS).
# Traffic CF→ALB stays inside AWS network via VPC Origin ENIs; HTTP acceptable.
resource "aws_cloudfront_vpc_origin" "alb_http" {
  vpc_origin_endpoint_config {
    name                   = "demo-platform-alb-internal-http"
    arn                    = data.terraform_remote_state.alb_internal.outputs.alb_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"
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
    domain_name = data.terraform_remote_state.alb_internal.outputs.alb_dns_name
    origin_id   = "alb-internal"
    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.alb_http.id
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
    acm_certificate_arn      = aws_acm_certificate_validation.cf.certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
