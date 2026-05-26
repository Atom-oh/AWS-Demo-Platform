output "cf_vpc_origin_id" { value = aws_cloudfront_vpc_origin.alb.id }
output "atlantis_cf_domain" { value = aws_cloudfront_distribution.atlantis.domain_name }
output "atlantis_cf_arn" { value = aws_cloudfront_distribution.atlantis.arn }
