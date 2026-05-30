output "repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "api_repository_url" {
  value = aws_ecr_repository.this["demo-platform/api"].repository_url
}

output "worker_repository_url" {
  value = aws_ecr_repository.this["demo-platform/worker"].repository_url
}
