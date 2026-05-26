output "atlantis_role_arn" {
  description = "ARN of the Atlantis IRSA role"
  value       = aws_iam_role.atlantis.arn
}

output "atlantis_secrets" {
  description = "ARNs of Atlantis Secrets Manager secrets"
  value = {
    github_app_id              = aws_secretsmanager_secret.atlantis_github_app_id.arn
    github_app_installation_id = aws_secretsmanager_secret.atlantis_github_app_installation_id.arn
    github_app_private_key     = aws_secretsmanager_secret.atlantis_github_app_private_key.arn
    github_webhook_secret      = aws_secretsmanager_secret.atlantis_github_webhook_secret.arn
  }
}
