output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "app_client_id" {
  value = aws_cognito_user_pool_client.dashboard.id
}

output "hosted_ui_domain" {
  value = "${aws_cognito_user_pool_domain.this.domain}.auth.ap-northeast-2.amazoncognito.com"
}
