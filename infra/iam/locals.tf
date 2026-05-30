data "aws_caller_identity" "current" {}

# ExternalId for the operator role trust — created out-of-band (Stage 1),
# value lives in Secrets Manager. We read it to bind the trust condition.
data "aws_secretsmanager_secret_version" "operator_external_id" {
  secret_id = "/demo-platform/external-ids/atomoh-main/operator"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = "ap-northeast-2"

  ddb_state_arn   = "arn:aws:dynamodb:${local.region}:${local.account_id}:table/demo-platform-state-dev"
  ddb_jobs_arn    = "arn:aws:dynamodb:${local.region}:${local.account_id}:table/demo-platform-jobs-dev"
  ddb_history_arn = "arn:aws:dynamodb:${local.region}:${local.account_id}:table/demo-platform-history-dev"
  sqs_jobs_arn    = "arn:aws:sqs:${local.region}:${local.account_id}:demo-platform-jobs-dev"

  operator_external_id = data.aws_secretsmanager_secret_version.operator_external_id.secret_string
}
