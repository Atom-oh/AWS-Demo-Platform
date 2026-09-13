# infra/cognito

Dashboard admin auth for dev. User Pool `atomoh-demo-platform-dev`
(self sign-up disabled, optional TOTP MFA) + public SPA client `dashboard-dev`
+ hosted-UI domain `atomoh-demo-platform-dev`.

- **State key**: `production/aws-demo-platform/cognito/terraform.tfstate`
- Writes `user_pool_id` / `app_client_id` into the existing `/demo-platform/dev/cognito/*`
  secret slots (created by `infra/secrets-manager`) via `aws_secretsmanager_secret_version`.
- Creating the `atomoh` user in the pool (console or `aws cognito-idp admin-create-user`) is
  a manual step, not managed in TF, since it needs an email/password that TF shouldn't hold.
- The API task injects the Cognito IDs from these slots and the production entry
  uses them for JWT verification. Create/populate them before starting that runtime;
  empty containers alone are insufficient. These IDs are public configuration, not
  a client secret or administrator password.
- `main.tf` allows callbacks at `admin-dev.atomai.click/auth/callback` and
  `localhost:3000/auth/callback`; tokenless local development on port 3001 is a
  separate mode. The SPA uses Authorization Code + PKCE and sends access tokens.
  Successful Cognito login still requires the API's `ADMIN_USERNAMES` allowlist.
