# DashboardEcsExecutionRole-dev — ECS agent role (ECR pull + CW logs).
# Distinct from the task role: this is what the ECS agent uses to start the
# container; the task role is what the app code runs as.

data "aws_iam_policy_document" "exec_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "exec" {
  name               = "DashboardEcsExecutionRole-dev"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ECS injects task-definition `secrets` (valueFrom) using the EXECUTION role at
# launch, so it needs GetSecretValue on the secrets the tasks reference (worker:
# github/pat + argocd/admin-token; future: dev/cognito/*).
data "aws_iam_policy_document" "exec_secrets" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/dev/*",
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/argocd/*",
    ]
  }
}

resource "aws_iam_role_policy" "exec_secrets" {
  name   = "DashboardEcsExecutionSecretsRead"
  role   = aws_iam_role.exec.id
  policy = data.aws_iam_policy_document.exec_secrets.json
}
