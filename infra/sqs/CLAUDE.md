# infra/sqs

Lifecycle Controller job queue (Stage 2, dev). `demo-platform-jobs-dev`
(visibility 300s, retention 1d, long-poll 20s) + `demo-platform-jobs-dlq-dev`
(maxReceiveCount 3).

- **State key**: `production/aws-demo-platform/sqs/terraform.tfstate`
- **Outputs**: `queue_url`, `queue_arn`, `dlq_arn`
- Requires `sqs:*` on `AtlantisIRSARole` (added in `atlantis-bootstrap`). NOTE: apply
  `atlantis-bootstrap` first and allow IAM propagation — a same-second apply can hit
  AccessDenied on `CreateQueue`. Atlantis project `sqs`.
