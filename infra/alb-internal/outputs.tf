output "alb_arn" { value = aws_lb.internal.arn }
output "alb_dns_name" { value = aws_lb.internal.dns_name }
output "alb_zone_id" { value = aws_lb.internal.zone_id }
output "alb_sg_id" { value = aws_security_group.alb_internal.id }
output "https_listener_arn" { value = aws_lb_listener.https.arn }
output "atlantis_tg_arn" { value = aws_lb_target_group.atlantis.arn }
output "acm_cert_arn" { value = data.aws_acm_certificate.alb_wildcard.arn }
