# infra/iam

Stage 2 dashboard IAM (dev) + GitHub Actions OIDC roles:
- `DashboardEcsTaskRole-dev` — ECS task identity; assumes Operator, reads DDB/SQS/Secrets/logs, `eks:DescribeCluster`.
- `DashboardEcsExecutionRole-dev` — ECS agent (ECR pull + CW logs via managed policy).
- `DemoPlatformOperator` — narrow cross-account toggle role; trusts the task role + ExternalId (from `/demo-platform/external-ids/atomoh-main/operator`).
- `demo-platform-gha-ecr-push` — GitHub Actions OIDC role (Phase 3); trust restricted to `repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main`; ECR push perms on `demo-platform/{api,worker,frontend}` + `actions-runner-claude`, and `ghcr/actions/*` pull-through-cache import (`BatchImportUpstreamImage`/`CreateRepository`) for the runner-image base. Used by `backend-ci.yml` (api/worker), `frontend-ci.yml` (frontend), and `runner-image.yml` (actions-runner-claude) push jobs.
- `ai-trader-web-terraform-plan` / `ai-trader-web-terraform-admin` — GitHub Actions OIDC role **pair** for the `Atom-oh/ai-trader-web` repo's `terraform.yml` ([ADR-012](../../docs/decisions/ADR-012-ai-trader-web-oidc-plan-apply-split.md)). `terraform plan` executes PR-branch-controlled provider/`external` code, so plan runs read-only: **plan** = `ReadOnlyAccess` + an inline **Deny** on the shared `multi-region-mall-terraform-state` bucket and `multi-region-mall-terraform-locks` table (ReadOnlyAccess's `s3:Get*` would otherwise let attacker-controlled plan code exfiltrate platform-wide tfstate; ai-trader-web uses local state so it needs neither), trust `pull_request` + `ref:refs/heads/main`; **admin** = `AdministratorAccess`, trust `environment:prod` **AND** `ref=refs/heads/main` (IAM-layer double gate, not solely dependent on the ai-trader-web repo's environment protection), `max_session_duration=7200`. Both in `ai-trader-web-gha-roles.tf`, reusing the shared `github` OIDC provider data source. The `ai-trader-web-*` naming (not `demo-platform-*`) is intentional — external-repo roles paired with the pre-existing out-of-band `ai-trader-web-gha-deploy` PowerUser role (untouched).

- **State key**: `production/aws-demo-platform/iam/terraform.tfstate`
- **Outputs**: `task_role_arn`, `exec_role_arn`, `operator_role_arn`
- Table/queue ARNs are constructed from `account_id` + fixed names (no cross-module state dependency). Region hardcoded `ap-northeast-2`.
- Runs as `AtlantisIRSARole` (has `iam:*`). Atlantis project `iam`.
- Friend accounts get their own `DemoPlatformOperator` copies in Stage 4.
