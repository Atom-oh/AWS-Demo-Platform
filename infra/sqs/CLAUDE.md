# infra/sqs

Lifecycle job queue for dev. `demo-platform-jobs-dev`
(visibility 300s, retention 1d, long-poll 20s) + `demo-platform-jobs-dlq-dev`
(14-day retention; jobs redrive after `maxReceiveCount = 3`).

- **State key**: `production/aws-demo-platform/sqs/terraform.tfstate`
- **Outputs**: `queue_url`, `queue_arn`, `dlq_arn`
- Requires `sqs:*` on `AtlantisIRSARole` (added in `atlantis-bootstrap`). That module needs
  to be applied first, with time for IAM propagation, since a same-second apply can hit
  AccessDenied on `CreateQueue`. Atlantis project `sqs`.
