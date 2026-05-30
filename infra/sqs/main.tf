# SQS job queue for the Lifecycle Controller worker (dev env).
# Spec §4.1.5: visibility 300s, retention 1d, DLQ maxReceiveCount=3.

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "demo-platform-jobs-dlq-dev"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "jobs" {
  name                       = "demo-platform-jobs-dev"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # long-poll friendly

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}
