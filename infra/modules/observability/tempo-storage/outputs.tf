output "bucket_name" {
  description = "Name of the Tempo S3 bucket"
  value       = aws_s3_bucket.tempo.id
}

output "bucket_arn" {
  description = "ARN of the Tempo S3 bucket"
  value       = aws_s3_bucket.tempo.arn
}

output "tempo_role_arn" {
  description = "ARN of the Tempo IRSA role"
  value       = aws_iam_role.tempo.arn
}
