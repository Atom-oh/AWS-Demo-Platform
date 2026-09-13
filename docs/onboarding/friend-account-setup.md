# Friend-account onboarding

The worker reads account roles from [`accounts.yaml`](../../accounts.yaml),
validated by [`account.ts`](../../dashboard/backend/packages/shared/src/schemas/account.ts).
It assumes the configured operator role with an ExternalId; Terraform automation
is configured separately. This checkout registers only `atomoh-main`; commented
friend entries are examples, not onboarded accounts.

## Roles and trust

Use an authorized administrator in the target account. Verify
`aws sts get-caller-identity` before changes. Agree two distinct ExternalIds with
the platform operator over a protected channel; keep values out of Git and logs.
The current account schema requires both role references:

| Target role | Trusted principal in account `180294183052` | Purpose |
| --- | --- | --- |
| `DemoPlatformOperator` | `DashboardEcsTaskRole-dev` | Worker ECS/EC2/RDS operations |
| `DemoPlatformTerraformer` | `AtlantisIRSARole` | Explicitly configured Terraform plan/apply |

These existing role names match the caller policies in
[`infra/iam/dashboard-ecs-task-role.tf`](../../infra/iam/dashboard-ecs-task-role.tf)
and [`infra/atlantis-bootstrap/main.tf`](../../infra/atlantis-bootstrap/main.tf).
Do not rename them solely to follow the new-resource naming prefix.

Prepare `operator-trust.json` in a protected local directory:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::180294183052:role/DashboardEcsTaskRole-dev"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "<AGREED_OPERATOR_EXTERNAL_ID>"
      }
    }
  }]
}
```

Prepare `terraformer-trust.json` with the same structure, substituting
`AtlantisIRSARole` as principal and the separate terraformer ExternalId. Trust
the named role, not the whole source account.

## Permissions and creation

Prepare `operator-perms.json` for the intended resources, using
[`demo-platform-operator.tf`](../../infra/iam/demo-platform-operator.tf) as the
implemented action reference. Its current statements cover:

- ECS service describe/list/update.
- EC2 instance describe/start/stop.
- RDS DB-instance describe/start/stop.
- Secrets Manager list/create/describe; no secret-value read in this policy.
- DynamoDB, ElastiCache and Kafka visibility actions.

The main-account policy uses broad resource selectors. Review and scope the
friend-account policy to its actual resources; do not label the copied policy
least privilege. Visibility-only schema types do not acquire lifecycle controllers
merely by adding IAM actions. Kubernetes resource control uses the configured
ArgoCD REST endpoint and needs separate cluster registration.

```bash
aws iam create-role --role-name DemoPlatformOperator \
  --assume-role-policy-document file://operator-trust.json \
  --query 'Role.Arn' --output text
aws iam put-role-policy --role-name DemoPlatformOperator \
  --policy-name DemoPlatformOperatorPerms \
  --policy-document file://operator-perms.json
aws iam create-role --role-name DemoPlatformTerraformer \
  --assume-role-policy-document file://terraformer-trust.json \
  --query 'Role.Arn' --output text
```

For accounts explicitly delegating broad infrastructure administration, the
historical setup attaches these two managed policies. They grant broad access;
use an agreed custom policy when that scope is not intended.

```bash
aws iam attach-role-policy --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam attach-role-policy --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
```

## Platform-side wiring and verification

1. Receive the account ID and role-creation confirmation. Store each agreed
   ExternalId in the platform account at
   `/demo-platform/external-ids/<account-name>/{operator,terraformer}` in the
   worker's configured Secrets Manager region. These values are provisioned
   separately from `infra/secrets-manager`'s dashboard containers.
2. Add a schema-valid entry with `name`, 12-digit `account_id`, `region`, and both
   `roles.*.{arn,external_id_secret}` fields. Match project `account` fields to
   that name; the schema does not verify cross-field account/ARN agreement.
3. Test each assume-role path from its actual trusted principal. An unrelated
   operator shell may correctly be denied. Prepare protected CLI input files with
   `RoleArn`, `RoleSessionName` and `ExternalId`, then print only the resulting ARN:

   ```bash
   aws sts assume-role --cli-input-json file://operator-assume.json \
     --query 'AssumedRoleUser.Arn' --output text
   aws sts assume-role --cli-input-json file://terraformer-assume.json \
     --query 'AssumedRoleUser.Arn' --output text
   ```

4. Configure the target Terraform provider to assume the terraformer role with
   its ExternalId, and register the repository/projects with Atlantis as needed.
   The standard workflow in `k8s/system/atlantis/configmap.yaml` only runs
   init/plan/apply; it does not read `accounts.yaml` or inject assume-role settings.
5. Build and explicitly roll the backend configuration into ECS. Project/account
   files are bundled into images, and metadata-only edits do not trigger current
   backend CI. Verify accepted configuration and a scoped operation; successful
   STS alone is not a complete lifecycle test. See the
   [ECS guide](../../infra/dashboard-ecs/CLAUDE.md).

## Revocation or rotation

Coordinate removal from platform metadata/automation with the account owner.
Revoke trust/access first when urgent; do not treat a metadata edit as IAM revocation.
Before deleting roles, inventory attached/inline policies and any instance-profile
membership, then remove those dependencies. For the exact policies created above:

```bash
aws iam delete-role-policy --role-name DemoPlatformOperator \
  --policy-name DemoPlatformOperatorPerms
aws iam detach-role-policy --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam detach-role-policy --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
aws iam delete-role --role-name DemoPlatformOperator
aws iam delete-role --role-name DemoPlatformTerraformer
```

Rotate a disclosed ExternalId by coordinating the trust condition and stored value,
then reverify the caller. Recreating the role is not the rotation mechanism.
