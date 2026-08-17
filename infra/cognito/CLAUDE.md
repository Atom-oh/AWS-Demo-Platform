# infra/cognito

Admin auth (Stage 2 Phase 4, dev). User Pool `atomoh-demo-platform-dev`
(self sign-up disabled, optional TOTP MFA) + public SPA client `dashboard-dev`
+ hosted-UI domain `atomoh-demo-platform-dev`.

- **State key**: `production/aws-demo-platform/cognito/terraform.tfstate`
- Writes `user_pool_id` / `app_client_id` into the existing `/demo-platform/dev/cognito/*`
  secret slots (created by `infra/secrets-manager`) via `aws_secretsmanager_secret_version`.
- Creating the `atomoh` user in the pool (console or `aws cognito-idp admin-create-user`) is
  a manual step, not managed in TF, since it needs an email/password that TF shouldn't hold.
- Applying this module before `dashboard-ecs` matters only if the api task ever injects
  cognito secrets — the current prod entry does not, so the ordering isn't strict yet.
