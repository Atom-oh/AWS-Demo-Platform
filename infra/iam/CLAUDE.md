# infra/iam

Stage 2 dashboard IAM (dev). Three roles:
- `DashboardEcsTaskRole-dev` — ECS task identity; assumes Operator, reads DDB/SQS/Secrets/logs, `eks:DescribeCluster`.
- `DashboardEcsExecutionRole-dev` — ECS agent (ECR pull + CW logs via managed policy).
- `DemoPlatformOperator` — narrow cross-account toggle role; trusts the task role + ExternalId (from `/demo-platform/external-ids/atomoh-main/operator`).

- **State key**: `production/aws-demo-platform/iam/terraform.tfstate`
- **Outputs**: `task_role_arn`, `exec_role_arn`, `operator_role_arn`
- Table/queue ARNs are constructed from `account_id` + fixed names (no cross-module state dependency). Region hardcoded `ap-northeast-2`.
- Runs as `AtlantisIRSARole` (has `iam:*`). Atlantis project `iam`.
- Friend accounts get their own `DemoPlatformOperator` copies in Stage 4.
