# Admin auth for the dashboard (Stage 2 Phase 4, dev). Spec §4.1.4.
# Single admin (atomoh), self sign-up disabled, optional TOTP MFA.
# The atomoh user is created out-of-band (console/CLI) — see CLAUDE.md.

resource "aws_cognito_user_pool" "this" {
  name                     = "atomoh-demo-platform-dev"
  mfa_configuration        = "OPTIONAL"
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true # no public sign-up
  }

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "atomoh-demo-platform-dev"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "dashboard" {
  name         = "dashboard-dev"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false # public SPA client (Stage 3 frontend)

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "https://admin-dev.atomai.click/auth/callback",
    "http://localhost:3000/auth/callback",
  ]
  logout_urls = [
    "https://admin-dev.atomai.click",
    "http://localhost:3000",
  ]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
}

# Populate the dev cognito secret slots created by infra/secrets-manager.
data "aws_secretsmanager_secret" "user_pool_id" {
  name = "/demo-platform/dev/cognito/user-pool-id"
}
data "aws_secretsmanager_secret" "app_client_id" {
  name = "/demo-platform/dev/cognito/app-client-id"
}

resource "aws_secretsmanager_secret_version" "user_pool_id" {
  secret_id     = data.aws_secretsmanager_secret.user_pool_id.id
  secret_string = aws_cognito_user_pool.this.id
}
resource "aws_secretsmanager_secret_version" "app_client_id" {
  secret_id     = data.aws_secretsmanager_secret.app_client_id.id
  secret_string = aws_cognito_user_pool_client.dashboard.id
}
