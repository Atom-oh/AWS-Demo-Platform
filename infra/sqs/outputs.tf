output "queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "queue_arn" {
  value = aws_sqs_queue.jobs.arn
}

output "dlq_arn" {
  value = aws_sqs_queue.jobs_dlq.arn
}
