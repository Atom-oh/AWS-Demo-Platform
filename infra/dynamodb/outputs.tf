output "state_table_name" {
  value = aws_dynamodb_table.state.name
}

output "state_table_arn" {
  value = aws_dynamodb_table.state.arn
}

output "jobs_table_name" {
  value = aws_dynamodb_table.jobs.name
}

output "jobs_table_arn" {
  value = aws_dynamodb_table.jobs.arn
}

output "history_table_name" {
  value = aws_dynamodb_table.history.name
}

output "history_table_arn" {
  value = aws_dynamodb_table.history.arn
}
