output "otel_collector_role_arn" {
  description = "ARN of the OTel Collector IRSA role"
  value       = aws_iam_role.otel_collector.arn
}
