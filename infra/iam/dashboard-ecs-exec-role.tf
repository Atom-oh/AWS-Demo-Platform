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
