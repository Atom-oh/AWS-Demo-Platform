# Dashboard and CI IAM

State key: `production/aws-demo-platform/iam/terraform.tfstate`; Atlantis project:
`iam`. Role ARNs are exported by `outputs.tf`.

| Role / source | Implemented boundary |
| --- | --- |
| `DashboardEcsTaskRole-dev` / `dashboard-ecs-task-role.tf` | Application identity; assumes `DemoPlatformOperator`, accesses platform DDB/SQS/Secrets/logs and describes EKS |
| `DashboardEcsExecutionRole-dev` / `dashboard-ecs-exec-role.tf` | ECS agent image pull/logging plus `GetSecretValue` for task-definition secret injection |
| `DemoPlatformOperator` / `demo-platform-operator.tf` | Trusts the task role with the configured ExternalId; ECS/EC2/RDS controls and secret/visibility actions |
| `demo-platform-gha-ecr-push` / `gha-ecr-push-role.tf` | GitHub OIDC restricted to `repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main`; runtime/runner image push and `ghcr/actions/*` cache import |

The operator action set is limited, but current permission statements use
`Resource: "*"`. Do not describe it as resource-scoped or copy it as a least-privilege
template without review. `locals.tf` reads the main-account operator ExternalId
from Secrets Manager; protect plans/state and never print its value. Existing
role names are not subject to a retroactive prefix rename.

`ai-trader-web-gha-roles.tf` defines external-repository identities:

- `ai-trader-web-terraform-plan`: PR/main OIDC trust, ReadOnlyAccess and explicit
  platform-store denies, including the shared state/lock table, runtime data,
  secret values, image pulls and configured Cognito pool.
- `ai-trader-web-terraform-admin`: AdministratorAccess with main-only OIDC trust.
- `ai-trader-web-gha-deploy`: retained PowerUser/inline IAM role, adopted through
  declarative `import` blocks and constrained to main-only trust. Inventory the
  external repository's consumers before retirement; this checkout cannot prove
  its workflow migration is complete.

The main-branch trust is implemented. GitHub branch/environment protection is a
separate live setting; the limitations recorded in
[ADR-012](../../docs/decisions/ADR-012-ai-trader-web-oidc-plan-apply-split.md)
are historical evidence, not a current protection check.

Table/queue ARNs use fixed names in `ap-northeast-2`; the shared state bucket and
lock table are in `us-east-1`. Apply prerequisite Atlantis permissions first.
For another account, use the [friend-account procedure](../../docs/onboarding/friend-account-setup.md);
editing `accounts.yaml` alone creates neither IAM roles nor Terraform provider wiring.
