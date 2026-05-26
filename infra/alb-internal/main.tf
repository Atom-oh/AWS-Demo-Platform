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

# CF VPC Origin's auto-managed SG. ID is dynamic — terraform can't reference directly
# (no attribute on aws_cloudfront_vpc_origin resource). Hardcoded after manual lookup.
# If VPC Origin recreated, update this value.
# Lookup command: aws ec2 describe-network-interfaces \
#   --filters "Name=vpc-id,Values=<VPC_ID>" "Name=description,Values=*CloudFront*" \
#   --query 'NetworkInterfaces[0].Groups[0].GroupId'
locals {
  cf_vpc_origin_sg_id = "sg-0a67fc7bfa9c2f0c6"
}

resource "aws_security_group" "alb_internal" {
  name        = "demo-platform-alb-internal"
  description = "Internal ALB for AWS Demo Platform (CF VPC Origin + RFC1918)"
  vpc_id      = local.vpc_id

  ingress {
    description = "Internal VPC + peered networks (RFC1918 subset, port 443)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  ingress {
    description     = "CloudFront VPC Origin (HTTPS)"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [local.cf_vpc_origin_sg_id]
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

data "aws_acm_certificate" "alb_wildcard" {
  domain      = "*.atomai.click"
  statuses    = ["ISSUED"]
  most_recent = true
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = data.aws_acm_certificate.alb_wildcard.arn

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

resource "aws_lb_listener_rule" "atlantis" {
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
