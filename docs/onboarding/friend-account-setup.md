# Friend Account Onboarding

How to set up your AWS account so that **atomoh's AWS Demo Platform** can
turn on/off demo resources, manage Terraform infrastructure, and read
demo URLs from it.

Two IAM roles are required:
- **DemoPlatformOperator** — runtime control (start/stop, scale).
- **DemoPlatformTerraformer** — Terraform plan/apply (broader permissions).

These are trusted via cross-account `sts:AssumeRole` from atomoh's main
account (`180294183052`), gated by an **ExternalId** that atomoh shares
with you over a secure channel (Signal / encrypted message — **not** Slack
or email plaintext).

## Prerequisites

- AWS account admin access
- AWS CLI configured to your account
- Two ExternalId values shared by atomoh:
  - one for the operator role
  - one for the terraformer role

## Step 1 — Create `DemoPlatformOperator` role

Save the trust policy to `operator-trust.json`:

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
        "sts:ExternalId": "<OPERATOR_EXTERNAL_ID_FROM_ATOMOH>"
      }
    }
  }]
}
```

Save permissions policy to `operator-perms.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECSControl",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices", "ecs:UpdateService",
        "ecs:ListServices", "ecs:ListTasks", "ecs:DescribeTasks"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EC2Control",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances", "ec2:StartInstances",
        "ec2:StopInstances", "ec2:DescribeInstanceStatus"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDSControl",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances", "rds:StartDBInstance", "rds:StopDBInstance"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsControl",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret", "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DescribeAlwaysOnResources",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable", "dynamodb:ListTables",
        "elasticache:DescribeCacheClusters",
        "kafka:DescribeCluster", "kafka:ListClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

Apply:

```bash
aws iam create-role \
  --role-name DemoPlatformOperator \
  --assume-role-policy-document file://operator-trust.json

aws iam put-role-policy \
  --role-name DemoPlatformOperator \
  --policy-name DemoPlatformOperatorPerms \
  --policy-document file://operator-perms.json
```

## Step 2 — Create `DemoPlatformTerraformer` role

Save trust policy to `terraformer-trust.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::180294183052:role/AtlantisIRSARole"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "<TERRAFORMER_EXTERNAL_ID_FROM_ATOMOH>"
      }
    }
  }]
}
```

Apply:

```bash
aws iam create-role \
  --role-name DemoPlatformTerraformer \
  --assume-role-policy-document file://terraformer-trust.json

aws iam attach-role-policy \
  --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

aws iam attach-role-policy \
  --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
```

`PowerUserAccess` + `IAMFullAccess` together provide enough scope for
Atlantis-driven Terraform on common infrastructure. If you want a tighter
custom policy, contact atomoh.

## Step 3 — Notify atomoh

Send to atomoh (over the same secure channel):
- Your **AWS account ID** (12 digits).
- Confirmation that **both roles are created** with the agreed ExternalIds.

## Verification (atomoh-side)

```bash
# Operator role
aws sts assume-role \
  --role-arn arn:aws:iam::<YOUR_ACCOUNT>:role/DemoPlatformOperator \
  --role-session-name verify-op \
  --external-id <OPERATOR_EXT_ID>

# Terraformer role
aws sts assume-role \
  --role-arn arn:aws:iam::<YOUR_ACCOUNT>:role/DemoPlatformTerraformer \
  --role-session-name verify-tf \
  --external-id <TERRAFORMER_EXT_ID>
```

Both must return temporary credentials. Then atomoh adds your entry to
[`accounts.yaml`](../../accounts.yaml) and Atlantis can manage your
account via PR.

## Revoking

If you ever need to withdraw access:
1. Delete the two roles (`aws iam delete-role`).
2. Notify atomoh so the entry is removed from `accounts.yaml`.

ExternalIds are stored in atomoh's AWS Secrets Manager — they should be
rotated if disclosed (delete role + recreate with new ExternalId).
