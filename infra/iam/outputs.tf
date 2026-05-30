output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "exec_role_arn" {
  value = aws_iam_role.exec.arn
}

output "operator_role_arn" {
  value = aws_iam_role.operator.arn
}
