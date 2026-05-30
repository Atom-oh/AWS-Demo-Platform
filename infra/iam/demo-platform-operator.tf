# DemoPlatformOperator (in atomoh-main) — narrow cross-account role the
# dashboard assumes to toggle resources. Spec §3.2. Trust = DashboardEcsTaskRole
# + ExternalId match. Since atomoh-main is the same account as the dashboard
# runtime, the role lives here; friend accounts get their own copies later.

data "aws_iam_policy_document" "operator_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.task.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [local.operator_external_id]
    }
  }
}

resource "aws_iam_role" "operator" {
  name               = "DemoPlatformOperator"
  assume_role_policy = data.aws_iam_policy_document.operator_assume.json
}

data "aws_iam_policy_document" "operator_perms" {
  statement {
    sid       = "EcsToggle"
    effect    = "Allow"
    actions   = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:ListServices"]
    resources = ["*"]
  }
  statement {
    sid       = "Ec2Toggle"
    effect    = "Allow"
    actions   = ["ec2:StartInstances", "ec2:StopInstances", "ec2:DescribeInstances"]
    resources = ["*"]
  }
  statement {
    sid       = "RdsToggle"
    effect    = "Allow"
    actions   = ["rds:StartDBInstance", "rds:StopDBInstance", "rds:DescribeDBInstances"]
    resources = ["*"]
  }
  statement {
    sid       = "SecretsManage"
    effect    = "Allow"
    actions   = ["secretsmanager:ListSecrets", "secretsmanager:CreateSecret", "secretsmanager:DescribeSecret"]
    resources = ["*"]
  }
  statement {
    sid       = "VisibilityOnly"
    effect    = "Allow"
    actions   = ["dynamodb:DescribeTable", "dynamodb:ListTables", "elasticache:Describe*", "kafka:Describe*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "operator" {
  name   = "DemoPlatformOperatorPermissions"
  role   = aws_iam_role.operator.id
  policy = data.aws_iam_policy_document.operator_perms.json
}
