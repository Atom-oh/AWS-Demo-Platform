# DashboardEcsTaskRole-dev — identity the api/worker ECS tasks run as.
# Spec §3.2. Assumes DemoPlatformOperator cross-account, reads DDB/SQS/Secrets.

data "aws_iam_policy_document" "task_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = "DashboardEcsTaskRole-dev"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

data "aws_iam_policy_document" "task_perms" {
  statement {
    sid       = "AssumeOperatorAnyAccount"
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/DemoPlatformOperator"]
  }

  statement {
    sid    = "DynamoDbState"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]
    resources = [
      local.ddb_state_arn,
      local.ddb_jobs_arn,
      "${local.ddb_jobs_arn}/index/*",
      local.ddb_history_arn,
    ]
  }

  statement {
    sid    = "SqsJobs"
    effect = "Allow"
    actions = [
      "sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage",
      "sqs:GetQueueAttributes", "sqs:GetQueueUrl",
    ]
    resources = [local.sqs_jobs_arn]
  }

  statement {
    sid    = "SecretsRead"
    effect = "Allow"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/dev/*",
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/external-ids/*",
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/argocd/*",
    ]
  }

  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:CreateLogGroup"]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/demo-platform/*"]
  }

  statement {
    sid       = "EksDescribeForHubAuth"
    effect    = "Allow"
    actions   = ["eks:DescribeCluster"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "DashboardEcsTaskPermissions"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_perms.json
}
