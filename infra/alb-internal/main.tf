data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_route53_zone" "public" {
  name         = "atomai.click."
  private_zone = false
}

locals {
  vpc_id             = data.terraform_remote_state.shared.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.shared.outputs.private_subnet_ids
}

resource "aws_security_group" "alb_internal" {
  name        = "demo-platform-alb-internal"
  description = "Internal ALB for AWS Demo Platform (CF VPC Origin + RFC1918)"
  vpc_id      = local.vpc_id

  ingress {
    description = "Internal VPC + peered networks (RFC1918 subset)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "internal" {
  name                       = "demo-platform-internal"
  internal                   = true
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb_internal.id]
  subnets                    = local.private_subnet_ids
  enable_deletion_protection = false
}

resource "aws_acm_certificate" "alb" {
  domain_name               = "atomai.click"
  subject_alternative_names = ["*.atomai.click"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "alb_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.alb.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.alb_cert_validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No matching listener rule"
      status_code  = "503"
    }
  }
}

# HTTP listener for CloudFront VPC Origin traffic
# (CF→ALB stays inside AWS network; HTTPS would require SNI for ALB AWS DNS name
#  which isn't in the wildcard cert. HTTP is acceptable for VPC-internal CF→ALB.)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No matching listener rule"
      status_code  = "503"
    }
  }
}

# Atlantis target group + listener rule
resource "aws_lb_target_group" "atlantis" {
  name        = "demo-platform-atlantis"
  port        = 4141
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "atlantis_https" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.atlantis.arn
  }
  condition {
    host_header { values = ["atlantis.atomai.click"] }
  }
}

resource "aws_lb_listener_rule" "atlantis_http" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.atlantis.arn
  }
  condition {
    host_header { values = ["atlantis.atomai.click"] }
  }
}
