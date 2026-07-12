# infra/iam

Stage 2 dashboard IAM (dev). Three roles:
- `DashboardEcsTaskRole-dev` — ECS task identity; assumes Operator, reads DDB/SQS/Secrets/logs, `eks:DescribeCluster`.
- `DashboardEcsExecutionRole-dev` — ECS agent (ECR pull + CW logs via managed policy).
- `DemoPlatformOperator` — narrow cross-account toggle role; trusts the task role + ExternalId (from `/demo-platform/external-ids/atomoh-main/operator`).
- `demo-platform-gha-ecr-push` — GitHub Actions OIDC role (Phase 3); trust restricted to `repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main`; ECR push perms on `demo-platform/{api,worker,frontend}` + `actions-runner-claude`, and `ghcr/actions/*` pull-through-cache import (`BatchImportUpstreamImage`/`CreateRepository`) for the runner-image base. Used by `backend-ci.yml` (api/worker), `frontend-ci.yml` (frontend), and `runner-image.yml` (actions-runner-claude) push jobs.
- `ai-trader-web-terraform-admin` — GitHub Actions OIDC role for the `Atom-oh/ai-trader-web` repo's `terraform.yml`; `AdministratorAccess` (managed policy) so `terraform plan/apply` can manage IAM + anything else. Being admin, trust is pinned to exact subs (`pull_request`, `ref:refs/heads/main`, `environment:prod`), not a wildcard. Reuses the shared `github` OIDC provider data source from `gha-ecr-push-role.tf`. (Separate from the pre-existing `ai-trader-web-gha-deploy` PowerUserAccess role, which is created out-of-band and left untouched.)

- **State key**: `production/aws-demo-platform/iam/terraform.tfstate`
- **Outputs**: `task_role_arn`, `exec_role_arn`, `operator_role_arn`
- Table/queue ARNs are constructed from `account_id` + fixed names (no cross-module state dependency). Region hardcoded `ap-northeast-2`.
- Runs as `AtlantisIRSARole` (has `iam:*`). Atlantis project `iam`.
- Friend accounts get their own `DemoPlatformOperator` copies in Stage 4.
