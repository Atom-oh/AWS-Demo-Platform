# Stage 1: Infra Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the ap-northeast-2 management cluster definition from `Atom-oh/multi-region-architecture` to `Atom-oh/AWS-Demo-Platform`, bootstrap Atlantis for PR-driven Terraform, and introduce CloudFront VPC Origins + Internal ALB + TargetGroupBinding pattern as the standard exposure model. Establish hub-spoke ArgoCD with App-of-Apps for tenants.

**Architecture:** Hub cluster (`mall-apne2-mgmt` EKS in ap-northeast-2) becomes the sole control plane. Atlantis manages Terraform for both repos via GitHub App. CloudFront → VPC Origin → Internal ALB → Target Group → TargetGroupBinding → k8s pod, with security group lock-down to CF VPC Origin SG + 10.0.0.0/8. ArgoCD master-root pattern auto-discovers new system components and tenant projects. ClickHouse replaces Tempo for traces/logs (metrics stay on Prometheus). 

**Tech Stack:** Terraform 1.9+, Atlantis (Helm-free k8s deploy), AWS Load Balancer Controller, ArgoCD, ClickHouse, Prometheus, ExternalSecrets, Kustomize. Cross-repo Terraform state via S3 backend + `terraform_remote_state` data source. GitHub App for Atlantis webhook auth.

**Spec reference:** `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`

**Project context:** Non-production environment ([[non-production-tolerance]]). Destructive cutover acceptable. Brief downtime during ArgoCD redeploy acceptable. Single admin (atomoh).

**Pre-requisites (manual before starting):**
- AWS CLI configured for atomoh main account with admin permissions
- kubectl configured to access `mall-apne2-mgmt` cluster (`aws eks update-kubeconfig --name mall-apne2-mgmt --region ap-northeast-2`)
- `gh` CLI authenticated as Atom-oh org member
- terraform CLI ≥ 1.9
- existing S3 backend bucket: `multi-region-mall-terraform-state` accessible
- read access to `Atom-oh/multi-region-architecture` repo

---

## Task 1: Repo skeleton

**Files:**
- Create: `AWS-Demo-Platform/.gitignore` (extend existing)
- Create: `AWS-Demo-Platform/README.md`
- Create: directory structure (empty placeholders with `.keep`)

- [ ] **Step 1: Verify clean working directory**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
git status
```
Expected: working tree clean. If untracked files present (e.g., screenshot), move or `.gitignore` them.

- [ ] **Step 2: Extend .gitignore**

Edit `/home/atomoh/AWS-Demo-Platform/.gitignore`:
```
# Skill-managed
.superpowers/

# Editor & local tools
.vscode/
.idea/
*.swp
.DS_Store

# Terraform
**/.terraform/
*.tfstate
*.tfstate.backup
*.tfplan
*.tfplan.binary
.terraform.lock.hcl

# Secrets — defense in depth
**/*.pem
**/*.key
**/secrets.yaml
**/secrets.local.*

# Local screenshots / scratch
*.png
*.jpg

# Node
node_modules/
.next/
.env.local
.env*.local
dist/
build/

# Python (if any)
__pycache__/
*.pyc
.venv/

# IDE & misc
*.log
```

- [ ] **Step 3: Create directory skeleton**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
mkdir -p \
  infra/modules \
  infra/eks-mgmt \
  infra/atlantis-bootstrap \
  infra/cloudfront \
  infra/alb-internal \
  infra/route53-private-zone \
  infra/iam \
  infra/global/state-bucket \
  infra/dynamodb \
  infra/cognito \
  infra/dashboard-ecs \
  k8s/system/argocd \
  k8s/system/argocd-cm-patch \
  k8s/system/atlantis \
  k8s/system/clickhouse-mgmt \
  k8s/system/prometheus-stack \
  k8s/system/grafana \
  k8s/system/karpenter-apne2-mgmt \
  k8s/system/actions-runner \
  k8s/system/runner-scheduler \
  k8s/system/storageclass \
  argocd-apps/system \
  argocd-apps/tenants \
  argocd-apps/bootstrap \
  dashboard/frontend \
  dashboard/backend \
  projects \
  docs/onboarding

# .keep files so empty dirs survive git
find infra k8s argocd-apps dashboard projects docs -type d -empty -exec touch {}/.keep \;
```

- [ ] **Step 4: Create README.md**

Write `/home/atomoh/AWS-Demo-Platform/README.md`:
```markdown
# AWS Demo Platform

Admin platform for managing demo projects across multiple AWS accounts.

See `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` for the full design.

## Repository structure

| Path | Purpose |
|---|---|
| `accounts.yaml` | Target AWS accounts (cross-account assume-role config) |
| `projects/*.yaml` | Per-project metadata (resources, URLs, on/off targets) |
| `infra/` | Terraform — hub cluster, network, IAM, dashboard infra |
| `k8s/system/` | Kustomize manifests for hub cluster system components |
| `argocd-apps/system/` | ArgoCD Application CRs for system components |
| `argocd-apps/tenants/` | ArgoCD root Application CRs for each tenant project (App-of-Apps) |
| `argocd-apps/bootstrap/` | Master-root Applications (one-time bootstrap) |
| `dashboard/` | Stage 3: admin UI + API (Next.js + Node.js TS) |
| `docs/superpowers/` | Specs, plans, ADRs |
| `docs/onboarding/` | Friend account onboarding guides |

## Operating model

- Non-production environment. Brief outages OK.
- Two environments: `main` branch → dev; semver tag → prod.
- Terraform changes go through Atlantis (PR `atlantis plan` / `atlantis apply`).
- k8s changes go through ArgoCD (auto-sync on hub).

See spec for full architecture details.
```

- [ ] **Step 5: Commit**

```bash
cd /home/atomoh/AWS-Demo-Platform
git add .gitignore README.md infra k8s argocd-apps dashboard projects docs
git commit -m "$(cat <<'EOF'
chore: repo skeleton for Stage 1 implementation

Per docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md.
Directory structure for Terraform (infra/), k8s manifests (k8s/system/),
ArgoCD App-of-Apps tree (argocd-apps/), dashboard (dashboard/),
project metadata (projects/), and docs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. Files staged include only the skeleton (no actual code yet).

---

## Task 2: Copy Terraform modules from multi-region-architecture

**Files:**
- Create: `infra/modules/compute/eks/` (copied from multi-region-arch)
- Create: `infra/modules/compute/alb/`
- Create: `infra/modules/networking/security-groups/` (only if mgmt-specific portion needed)
- Create: `infra/modules/observability/otel-collector-irsa/`
- Create: `infra/modules/observability/tempo-storage/` ← (will be removed in Task 12, copy now for reference during migration)

We copy via `gh api` rather than cloning multi-region-architecture, to avoid local working copy ambiguity.

- [ ] **Step 1: Identify modules used by eks-mgmt**

Run:
```bash
gh api repos/Atom-oh/multi-region-architecture/contents/terraform/environments/production/ap-northeast-2/eks-mgmt/main.tf \
  --jq '.content' | base64 -d | grep -E 'source\s*=' | sort -u
```
Expected output (subset):
```
source = "../../../../modules/compute/eks"
source = "../../../../modules/compute/alb"
source = "../../../../modules/observability/otel-collector-irsa"
source = "../../../../modules/observability/tempo-storage"
```

Note the module list. These are the minimum to copy.

- [ ] **Step 2: Copy each module using a helper**

Write a one-time helper script `/tmp/copy-modules.sh`:
```bash
#!/bin/bash
set -euo pipefail
REPO="Atom-oh/multi-region-architecture"
MODULES=(
  "compute/eks"
  "compute/alb"
  "observability/otel-collector-irsa"
  "observability/tempo-storage"
)
DEST="/home/atomoh/AWS-Demo-Platform/infra/modules"

for mod in "${MODULES[@]}"; do
  src_path="terraform/modules/${mod}"
  dest_path="${DEST}/${mod}"
  mkdir -p "${dest_path}"
  echo "=== ${mod} ==="
  gh api "repos/${REPO}/contents/${src_path}" --jq '.[].name' | while read -r fname; do
    if [[ "$fname" == *.tf || "$fname" == *.md ]]; then
      gh api "repos/${REPO}/contents/${src_path}/${fname}" --jq '.content' | base64 -d > "${dest_path}/${fname}"
      echo "  ${fname}"
    fi
  done
done
```

Run:
```bash
bash /tmp/copy-modules.sh
```
Expected: each module's `.tf` files copied. Verify with `ls infra/modules/compute/eks/`.

- [ ] **Step 3: Verify module integrity**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
for mod_dir in infra/modules/*/*; do
  [[ -d "$mod_dir" ]] || continue
  echo "=== $mod_dir ==="
  ls "$mod_dir"
done
```
Expected: each module dir has `main.tf`, `variables.tf`, `outputs.tf` (at minimum).

- [ ] **Step 4: terraform fmt + validate**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
terraform fmt -recursive infra/modules/
# validate requires a workspace; skip per-module validate, will catch in eks-mgmt step
```
Expected: no output (= no formatting issues), or list of files reformatted.

- [ ] **Step 5: Commit**

```bash
git add infra/modules/
git commit -m "infra: copy mgmt-relevant Terraform modules from multi-region-architecture

Source: Atom-oh/multi-region-architecture@main
Modules: compute/eks, compute/alb, observability/otel-collector-irsa, observability/tempo-storage

tempo-storage will be removed in a later task (replaced by ClickHouse for tracing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migrate eks-mgmt Terraform (cross-repo remote_state)

**Files:**
- Create: `infra/eks-mgmt/backend.tf`
- Create: `infra/eks-mgmt/main.tf`
- Create: `infra/eks-mgmt/variables.tf`
- Create: `infra/eks-mgmt/outputs.tf`
- Create: `infra/eks-mgmt/terraform.tfvars`

- [ ] **Step 1: Fetch source files**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform/infra/eks-mgmt
for f in backend.tf main.tf variables.tf outputs.tf terraform.tfvars; do
  gh api "repos/Atom-oh/multi-region-architecture/contents/terraform/environments/production/ap-northeast-2/eks-mgmt/${f}" \
    --jq '.content' | base64 -d > "$f"
done
ls -la
```
Expected: 5 files present.

- [ ] **Step 2: Update module source paths**

The original modules were at `../../../../modules/`. After move, they're at `../modules/`.

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform/infra/eks-mgmt
sed -i 's|../../../../modules/|../modules/|g' main.tf
grep 'source\s*=' main.tf
```
Expected: all module sources now reference `../modules/...`.

- [ ] **Step 3: Verify backend.tf unchanged**

```bash
cat infra/eks-mgmt/backend.tf
```
Expected: backend points to `multi-region-mall-terraform-state` bucket with key `production/ap-northeast-2/eks-mgmt/terraform.tfstate`. **Do not change this.** State location physically unchanged; only the Terraform code moves.

- [ ] **Step 4: terraform init + plan (verify no drift)**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform/infra/eks-mgmt
terraform init
terraform plan
```
Expected: `No changes. Your infrastructure matches the configuration.` (If diff appears, investigate — should be identical to multi-region-arch's previous code.)

- [ ] **Step 5: Commit**

```bash
cd /home/atomoh/AWS-Demo-Platform
git add infra/eks-mgmt/
git commit -m "infra(eks-mgmt): migrate Terraform code from multi-region-architecture

Cluster: mall-apne2-mgmt (ap-northeast-2, hub).
Backend.tf unchanged — state bucket and key remain at
multi-region-mall-terraform-state/production/ap-northeast-2/eks-mgmt/terraform.tfstate.
'terraform plan' verifies no drift after migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Atlantis bootstrap Terraform (IRSA, S3, target role templates)

**Files:**
- Create: `infra/atlantis-bootstrap/backend.tf`
- Create: `infra/atlantis-bootstrap/main.tf`
- Create: `infra/atlantis-bootstrap/variables.tf`
- Create: `infra/atlantis-bootstrap/outputs.tf`
- Create: `docs/onboarding/friend-iam-templates.md`

This creates resources that the rest of Stage 1 depends on. State is new (no migration).

- [ ] **Step 1: backend.tf — new state key**

Write `infra/atlantis-bootstrap/backend.tf`:
```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
  backend "s3" {
    bucket       = "multi-region-mall-terraform-state"
    key          = "production/aws-demo-platform/atlantis-bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-2"
  default_tags {
    tags = {
      Project     = "aws-demo-platform"
      Component   = "atlantis-bootstrap"
      ManagedBy   = "terraform"
      Environment = "shared"
    }
  }
}
```

- [ ] **Step 2: main.tf — IRSA, S3 lock table, Secrets slots**

Write `infra/atlantis-bootstrap/main.tf`:
```hcl
# Reference existing eks-mgmt cluster state for OIDC provider
data "terraform_remote_state" "eks_mgmt" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/eks-mgmt/terraform.tfstate"
    region = "us-east-1"
  }
}

locals {
  oidc_provider_arn = data.terraform_remote_state.eks_mgmt.outputs.oidc_provider_arn
  oidc_provider_url = data.terraform_remote_state.eks_mgmt.outputs.oidc_provider_url
}

# ─────────────────────────────────────────────────────────────────────
# Atlantis IRSA Role
# ─────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "atlantis_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(local.oidc_provider_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:atlantis:atlantis"]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(local.oidc_provider_url, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "atlantis" {
  name               = "AtlantisIRSARole"
  assume_role_policy = data.aws_iam_policy_document.atlantis_assume.json
}

data "aws_iam_policy_document" "atlantis_perms" {
  # AssumeRole into target accounts (Terraformer role)
  statement {
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/DemoPlatformTerraformer"]
  }
  # S3 state bucket access
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::multi-region-mall-terraform-state",
      "arn:aws:s3:::multi-region-mall-terraform-state/*"
    ]
  }
  # Secrets Manager — atlantis secrets only
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["arn:aws:secretsmanager:ap-northeast-2:${data.aws_caller_identity.current.account_id}:secret:/demo-platform/atlantis/*"]
  }
  # Self account terraform also needs broad perms (Atlantis manages this account too).
  # Scope to PowerUser-equivalent — adjust if too broad.
  statement {
    effect = "Allow"
    actions = [
      "ec2:*", "eks:*", "iam:*", "elasticloadbalancing:*",
      "cloudfront:*", "route53:*", "acm:*",
      "secretsmanager:*", "dynamodb:*", "logs:*",
      "ecr:*", "ecs:*", "cognito-idp:*", "kms:*",
      "rds:Describe*", "elasticache:Describe*", "kafka:Describe*"
    ]
    resources = ["*"]
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "atlantis" {
  name   = "AtlantisPermissions"
  role   = aws_iam_role.atlantis.id
  policy = data.aws_iam_policy_document.atlantis_perms.json
}

# ─────────────────────────────────────────────────────────────────────
# Secrets Manager slots (created empty; values populated manually in Task 6)
# ─────────────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "atlantis_github_app_id" {
  name        = "/demo-platform/atlantis/github-app-id"
  description = "Atlantis GitHub App ID"
}
resource "aws_secretsmanager_secret" "atlantis_github_app_installation_id" {
  name        = "/demo-platform/atlantis/github-app-installation-id"
  description = "Atlantis GitHub App Installation ID"
}
resource "aws_secretsmanager_secret" "atlantis_github_app_private_key" {
  name        = "/demo-platform/atlantis/github-app-private-key"
  description = "Atlantis GitHub App private key (PEM)"
}
resource "aws_secretsmanager_secret" "atlantis_github_webhook_secret" {
  name        = "/demo-platform/atlantis/github-webhook-secret"
  description = "Atlantis GitHub webhook signing secret"
}
```

- [ ] **Step 3: variables.tf + outputs.tf**

Write `infra/atlantis-bootstrap/variables.tf`:
```hcl
# No variables for bootstrap; all values are derived from remote state and locals.
```

Write `infra/atlantis-bootstrap/outputs.tf`:
```hcl
output "atlantis_role_arn" {
  description = "ARN of the Atlantis IRSA role"
  value       = aws_iam_role.atlantis.arn
}

output "atlantis_secrets" {
  description = "ARNs of Atlantis Secrets Manager secrets"
  value = {
    github_app_id              = aws_secretsmanager_secret.atlantis_github_app_id.arn
    github_app_installation_id = aws_secretsmanager_secret.atlantis_github_app_installation_id.arn
    github_app_private_key     = aws_secretsmanager_secret.atlantis_github_app_private_key.arn
    github_webhook_secret      = aws_secretsmanager_secret.atlantis_github_webhook_secret.arn
  }
}
```

- [ ] **Step 4: terraform fmt + validate**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform/infra/atlantis-bootstrap
terraform fmt
terraform init
terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd /home/atomoh/AWS-Demo-Platform
git add infra/atlantis-bootstrap/
git commit -m "infra(atlantis-bootstrap): IRSA + Secrets Manager slots

Creates:
- AtlantisIRSARole (IRSA for atlantis serviceaccount on mall-apne2-mgmt)
- Permissions for cross-account AssumeRole, S3 state, and broad
  same-account terraform operations
- Empty Secrets Manager slots for GitHub App credentials (populated
  manually in Task 6)

Reads remote_state from eks-mgmt for OIDC provider ARN.
New state key: production/aws-demo-platform/atlantis-bootstrap/terraform.tfstate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Apply atlantis-bootstrap locally (one-time, manual)

This is a manual `terraform apply` from local because Atlantis itself doesn't exist yet (chicken-and-egg).

- [ ] **Step 1: Verify AWS credentials**

Run:
```bash
aws sts get-caller-identity
```
Expected: returns atomoh main account info (account ID matches what's in spec).

- [ ] **Step 2: Plan**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform/infra/atlantis-bootstrap
terraform plan -out=tfplan.binary
```
Expected output (summary): "Plan: 6 to add, 0 to change, 0 to destroy." (1 role, 1 policy, 4 secrets)

- [ ] **Step 3: Review plan output**

Run:
```bash
terraform show tfplan.binary | head -60
```
Expected: confirms IAM role creation, secrets creation, no unexpected resources.

- [ ] **Step 4: Apply**

Run:
```bash
terraform apply tfplan.binary
```
Expected: "Apply complete! Resources: 6 added, 0 changed, 0 destroyed."

Outputs printed:
```
atlantis_role_arn = "arn:aws:iam::<account>:role/AtlantisIRSARole"
atlantis_secrets  = { ... }
```

- [ ] **Step 5: Save outputs for later reference**

Run:
```bash
terraform output -json > /tmp/atlantis-bootstrap-outputs.json
cat /tmp/atlantis-bootstrap-outputs.json
```

You will reference `atlantis_role_arn` in Task 7 (k8s manifest).

- [ ] **Step 6: Clean tfplan binary**

Run:
```bash
rm -f tfplan.binary
git status
```
Expected: working tree clean (no tfplan.binary tracked since .gitignore excludes them).

---

## Task 6: Create GitHub App + populate Secrets Manager

This is a fully manual one-time setup. The plan documents it for repeatability.

- [ ] **Step 1: Create GitHub App on github.com**

Open browser: `https://github.com/organizations/Atom-oh/settings/apps/new`

Fill in:
- **GitHub App name**: `atomoh-atlantis`
- **Homepage URL**: `https://github.com/Atom-oh/AWS-Demo-Platform`
- **Webhook**: Active (checked)
- **Webhook URL**: `https://atlantis.atomai.click/events` (will be reachable after Task 13; temporarily ok if 404)
- **Webhook secret**: Generate a random 40+ char string. Save it temporarily; you'll paste into Secrets Manager.
  - Generate: `openssl rand -hex 32`
- **Permissions** (Repository permissions):
  - Contents: Read & write
  - Issues: Read & write
  - Pull requests: Read & write
  - Commit statuses: Read & write
  - Webhooks: Read & write
  - Checks: Read & write
- **Subscribe to events**: Issue comment, Pull request, Pull request review, Push
- **Where can this GitHub App be installed?**: Only on this account

Click **Create GitHub App**. Note the **App ID** at the top of the next page.

- [ ] **Step 2: Generate private key**

In the App's settings page, scroll to "Private keys" → "Generate a private key". Download the `.pem` file.

- [ ] **Step 3: Install the App on Atom-oh**

In the App's settings, click "Install App" → choose `Atom-oh` org → **Only select repositories** → choose `AWS-Demo-Platform` and `multi-region-architecture`. Click Install.

After install, note the **Installation ID** from the URL of the installation page (it's the trailing integer in `https://github.com/organizations/Atom-oh/settings/installations/<INSTALLATION_ID>`).

- [ ] **Step 4: Populate Secrets Manager**

Run (substitute values):
```bash
APP_ID="<from Step 1>"
INSTALLATION_ID="<from Step 3>"
WEBHOOK_SECRET="<from Step 1>"
PRIVATE_KEY_PATH="<path to downloaded .pem>"

aws secretsmanager put-secret-value \
  --secret-id /demo-platform/atlantis/github-app-id \
  --secret-string "$APP_ID" \
  --region ap-northeast-2

aws secretsmanager put-secret-value \
  --secret-id /demo-platform/atlantis/github-app-installation-id \
  --secret-string "$INSTALLATION_ID" \
  --region ap-northeast-2

aws secretsmanager put-secret-value \
  --secret-id /demo-platform/atlantis/github-webhook-secret \
  --secret-string "$WEBHOOK_SECRET" \
  --region ap-northeast-2

aws secretsmanager put-secret-value \
  --secret-id /demo-platform/atlantis/github-app-private-key \
  --secret-string "$(cat "$PRIVATE_KEY_PATH")" \
  --region ap-northeast-2
```
Expected: each returns `{"ARN": "...", "Name": "...", "VersionId": "..."}`.

- [ ] **Step 5: Verify**

Run:
```bash
for secret in github-app-id github-app-installation-id github-webhook-secret; do
  echo "=== $secret ==="
  aws secretsmanager get-secret-value \
    --secret-id "/demo-platform/atlantis/$secret" \
    --region ap-northeast-2 \
    --query SecretString --output text | head -c 20
  echo
done
echo "=== private-key length ==="
aws secretsmanager get-secret-value \
  --secret-id /demo-platform/atlantis/github-app-private-key \
  --region ap-northeast-2 \
  --query SecretString --output text | wc -c
```
Expected: each secret returns plausible value. Private key length > 1500 chars.

- [ ] **Step 6: Securely discard local files**

Run:
```bash
shred -u "$PRIVATE_KEY_PATH"
# unset env vars in shell history
history -d $((HISTCMD-N))  # delete recent history if needed
```

No commit step — this task only produces external (AWS) state.

---

## Task 7: Atlantis k8s manifests + ClusterSecretStore prerequisite

**Files:**
- Create: `k8s/system/atlantis/namespace.yaml`
- Create: `k8s/system/atlantis/serviceaccount.yaml`
- Create: `k8s/system/atlantis/external-secret.yaml`
- Create: `k8s/system/atlantis/deployment.yaml`
- Create: `k8s/system/atlantis/service.yaml`
- Create: `k8s/system/atlantis/configmap.yaml`
- Create: `k8s/system/atlantis/kustomization.yaml`
- Verify: `external-secrets` ClusterSecretStore exists; if not, add to `multi-region-architecture/k8s/infra/external-secrets/`

- [ ] **Step 1: Verify ClusterSecretStore exists on hub**

Run:
```bash
kubectl get clustersecretstore -A
```
Expected: a CSS named `aws-secrets-manager` (or similar) exists. If not exists, see Step 2.

- [ ] **Step 2: (Conditional) Create ClusterSecretStore manifest**

If Step 1 returns no CSS, create `multi-region-architecture/k8s/infra/external-secrets/cluster-secret-store.yaml`:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-northeast-2
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
```

Commit + PR to multi-region-architecture. (Atlantis isn't up yet — apply via kubectl: `kubectl apply -f cluster-secret-store.yaml`.)

- [ ] **Step 3: namespace.yaml**

Write `k8s/system/atlantis/namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: atlantis
  labels:
    name: atlantis
    pod-security.kubernetes.io/enforce: baseline
```

- [ ] **Step 4: serviceaccount.yaml (IRSA annotation)**

Write `k8s/system/atlantis/serviceaccount.yaml`:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: atlantis
  namespace: atlantis
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<ATOMOH_MAIN_ACCOUNT_ID>:role/AtlantisIRSARole
```

Replace `<ATOMOH_MAIN_ACCOUNT_ID>` with the actual ID from `aws sts get-caller-identity` (Task 5).

- [ ] **Step 5: external-secret.yaml (sync GitHub App creds to k8s Secret)**

Write `k8s/system/atlantis/external-secret.yaml`:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: atlantis-github-app
  namespace: atlantis
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: atlantis-github-app
    creationPolicy: Owner
  data:
    - secretKey: app-id
      remoteRef: { key: /demo-platform/atlantis/github-app-id }
    - secretKey: installation-id
      remoteRef: { key: /demo-platform/atlantis/github-app-installation-id }
    - secretKey: private-key
      remoteRef: { key: /demo-platform/atlantis/github-app-private-key }
    - secretKey: webhook-secret
      remoteRef: { key: /demo-platform/atlantis/github-webhook-secret }
```

- [ ] **Step 6: configmap.yaml (Atlantis server config)**

Write `k8s/system/atlantis/configmap.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: atlantis-config
  namespace: atlantis
data:
  repos.yaml: |
    repos:
      - id: github.com/Atom-oh/AWS-Demo-Platform
        workflow: standard
        allowed_overrides: [workflow, apply_requirements]
        apply_requirements: [approved, mergeable]
        delete_source_branch_on_merge: false
      - id: github.com/Atom-oh/multi-region-architecture
        workflow: standard
        allowed_overrides: [workflow, apply_requirements]
        apply_requirements: [approved, mergeable]
        delete_source_branch_on_merge: false

    workflows:
      standard:
        plan:
          steps:
            - init
            - plan
        apply:
          steps:
            - apply
```

- [ ] **Step 7: deployment.yaml**

Write `k8s/system/atlantis/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atlantis
  namespace: atlantis
spec:
  replicas: 1
  selector:
    matchLabels: { app: atlantis }
  template:
    metadata:
      labels: { app: atlantis }
    spec:
      serviceAccountName: atlantis
      containers:
        - name: atlantis
          image: ghcr.io/runatlantis/atlantis:v0.30.0
          args:
            - server
            - --repo-config=/etc/atlantis/repos.yaml
            - --atlantis-url=https://atlantis.atomai.click
            - --gh-app-id=$(GH_APP_ID)
            - --gh-app-installation-id=$(GH_APP_INSTALLATION_ID)
            - --gh-app-key-file=/secrets/private-key
            - --gh-webhook-secret=$(GH_WEBHOOK_SECRET)
            - --repo-allowlist=github.com/Atom-oh/*
            - --port=4141
            - --automerge=false
            - --hide-prev-plan-comments=true
          env:
            - name: GH_APP_ID
              valueFrom:
                secretKeyRef: { name: atlantis-github-app, key: app-id }
            - name: GH_APP_INSTALLATION_ID
              valueFrom:
                secretKeyRef: { name: atlantis-github-app, key: installation-id }
            - name: GH_WEBHOOK_SECRET
              valueFrom:
                secretKeyRef: { name: atlantis-github-app, key: webhook-secret }
          ports:
            - { name: atlantis, containerPort: 4141 }
          volumeMounts:
            - { name: repos, mountPath: /etc/atlantis }
            - { name: secrets, mountPath: /secrets, readOnly: true }
            - { name: data, mountPath: /atlantis-data }
          resources:
            requests: { cpu: 200m, memory: 512Mi }
            limits:   { cpu: 1000m, memory: 2Gi }
      volumes:
        - name: repos
          configMap: { name: atlantis-config }
        - name: secrets
          secret:
            secretName: atlantis-github-app
            items:
              - { key: private-key, path: private-key }
        - name: data
          emptyDir: {}
```

- [ ] **Step 8: service.yaml**

Write `k8s/system/atlantis/service.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: atlantis
  namespace: atlantis
spec:
  type: ClusterIP
  selector: { app: atlantis }
  ports:
    - { name: atlantis, port: 80, targetPort: 4141, protocol: TCP }
```

- [ ] **Step 9: kustomization.yaml**

Write `k8s/system/atlantis/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - serviceaccount.yaml
  - external-secret.yaml
  - configmap.yaml
  - deployment.yaml
  - service.yaml
```

- [ ] **Step 10: Kustomize build dry-run**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
kustomize build k8s/system/atlantis/ | head -50
kustomize build k8s/system/atlantis/ | wc -l
```
Expected: valid yaml output, ~150 lines.

- [ ] **Step 11: Commit**

```bash
git add k8s/system/atlantis/
git commit -m "k8s(atlantis): manifests for hub cluster deployment

- Namespace + ServiceAccount with IRSA annotation
- ExternalSecret syncs GitHub App credentials from Secrets Manager
- ConfigMap with repos.yaml allowing AWS-Demo-Platform and
  multi-region-architecture repos
- Deployment (replica=1, atlantis v0.30.0)
- Service (ClusterIP, port 80 → 4141)

TGB to Internal ALB added in Task 13 after ALB infra exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Apply Atlantis to hub cluster (kubectl, one-time)

This is the manual bootstrap apply. Once Atlantis is running, future k8s changes go through ArgoCD.

- [ ] **Step 1: Apply manifests**

Run:
```bash
cd /home/atomoh/AWS-Demo-Platform
kubectl apply -k k8s/system/atlantis/
```
Expected:
```
namespace/atlantis created
serviceaccount/atlantis created
externalsecret.external-secrets.io/atlantis-github-app created
configmap/atlantis-config created
deployment.apps/atlantis created
service/atlantis created
```

- [ ] **Step 2: Wait for ExternalSecret to sync**

Run:
```bash
kubectl wait --for=condition=Ready externalsecret/atlantis-github-app -n atlantis --timeout=60s
kubectl get secret atlantis-github-app -n atlantis
```
Expected: Secret exists with 4 keys (app-id, installation-id, private-key, webhook-secret).

- [ ] **Step 3: Wait for Atlantis pod**

Run:
```bash
kubectl wait --for=condition=Ready pod -l app=atlantis -n atlantis --timeout=120s
kubectl get pods -n atlantis
```
Expected: pod is `Ready`.

- [ ] **Step 4: Check Atlantis logs**

Run:
```bash
kubectl logs deploy/atlantis -n atlantis --tail=50
```
Expected: lines containing "Atlantis started" and no fatal errors. (GitHub webhook 404s are OK at this stage — we haven't pointed traffic at it yet.)

- [ ] **Step 5: Temporary port-forward for sanity check**

Run:
```bash
kubectl port-forward -n atlantis svc/atlantis 4141:80 &
PF_PID=$!
sleep 2
curl -s http://localhost:4141/healthz
echo
kill $PF_PID 2>/dev/null
```
Expected: response `OK` or similar.

- [ ] **Step 6: (No commit; verification only)**

This task produced no repo changes.

---

## Task 9: Internal ALB Terraform (skeleton with no listener rules yet)

**Files:**
- Create: `infra/alb-internal/backend.tf`
- Create: `infra/alb-internal/main.tf`
- Create: `infra/alb-internal/variables.tf`
- Create: `infra/alb-internal/outputs.tf`

This Terraform will be applied via Atlantis (now that Atlantis is up). PR flow.

- [ ] **Step 1: backend.tf**

Write `infra/alb-internal/backend.tf`:
```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
  backend "s3" {
    bucket       = "multi-region-mall-terraform-state"
    key          = "production/aws-demo-platform/alb-internal/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-2"
  default_tags {
    tags = {
      Project   = "aws-demo-platform"
      Component = "alb-internal"
      ManagedBy = "terraform"
    }
  }
}
```

- [ ] **Step 2: main.tf — Internal ALB + SGs**

Write `infra/alb-internal/main.tf`:
```hcl
# Read shared state (multi-region-architecture owns shared/ — VPC, subnets, KMS)
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}

data "aws_caller_identity" "current" {}

locals {
  vpc_id             = data.terraform_remote_state.shared.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.shared.outputs.private_subnet_ids
}

# ─────────────────────────────────────────────────────────────────────
# Security Group for Internal ALB
# ─────────────────────────────────────────────────────────────────────
resource "aws_security_group" "alb_internal" {
  name        = "demo-platform-alb-internal"
  description = "Internal ALB for AWS Demo Platform (CF VPC Origin + RFC1918)"
  vpc_id      = local.vpc_id

  # Internal VPC + peered networks
  ingress {
    description = "Internal VPC + peered networks (RFC1918 subset)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  # CloudFront VPC Origin (source SG added in infra/cloudfront after VPC Origin created)
  # Intentionally left to be amended by a follow-up rule resource.

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─────────────────────────────────────────────────────────────────────
# Internal ALB
# ─────────────────────────────────────────────────────────────────────
resource "aws_lb" "internal" {
  name               = "demo-platform-internal"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_internal.id]
  subnets            = local.private_subnet_ids

  enable_deletion_protection = false # non-prod
}

# ─────────────────────────────────────────────────────────────────────
# HTTPS Listener (default 503 — actual rules added by per-component TF)
# ─────────────────────────────────────────────────────────────────────
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No matching listener rule"
      status_code  = "503"
    }
  }
}

# ─────────────────────────────────────────────────────────────────────
# ACM cert for ALB (regional, in ap-northeast-2)
# ─────────────────────────────────────────────────────────────────────
resource "aws_acm_certificate" "alb" {
  domain_name               = "atomai.click"
  subject_alternative_names = ["*.atomai.click"]
  validation_method         = "DNS"

  lifecycle { create_before_destroy = true }
}

# DNS validation records live in route53-private-zone or route53-public (managed elsewhere — Task 11)
# Here we just declare validation and assume external creation of records.
# If the public zone is managed in this same Terraform tree, add aws_route53_record validation.
# For now, we expect external DNS setup. If validation cert is in pending state, Terraform
# apply will wait.
resource "aws_acm_certificate_validation" "alb" {
  certificate_arn = aws_acm_certificate.alb.arn
  # validation_record_fqdns = ... (filled by route53-public-zone TF or manual)
}
```

- [ ] **Step 3: outputs.tf**

Write `infra/alb-internal/outputs.tf`:
```hcl
output "alb_arn" {
  value = aws_lb.internal.arn
}
output "alb_dns_name" {
  value = aws_lb.internal.dns_name
}
output "alb_zone_id" {
  value = aws_lb.internal.zone_id
}
output "alb_sg_id" {
  value = aws_security_group.alb_internal.id
}
output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}
```

- [ ] **Step 4: variables.tf**

Write `infra/alb-internal/variables.tf`:
```hcl
# All values currently derived from remote state / locals. No input variables yet.
```

- [ ] **Step 5: Local terraform fmt**

```bash
cd /home/atomoh/AWS-Demo-Platform
terraform fmt -recursive infra/alb-internal/
```

- [ ] **Step 6: Commit + push (and create PR for Atlantis to plan)**

```bash
git checkout -b feature/alb-internal
git add infra/alb-internal/
git commit -m "infra(alb-internal): Internal ALB skeleton with CF/RFC1918 SG

- Internal ALB (load_balancer_type=application, internal=true)
- SG allows 10.0.0.0/8 inbound on 443. CF VPC Origin SG rule
  added in a follow-up after VPC Origin is created (infra/cloudfront).
- HTTPS listener with default 503 (per-component rules added by
  feature-specific TF, e.g., infra/cloudfront/atlantis-rule.tf)
- ACM cert for *.atomai.click (DNS validation, requires public R53 zone records)

State key: production/aws-demo-platform/alb-internal/terraform.tfstate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feature/alb-internal
gh pr create --title "infra: Internal ALB skeleton" --body "$(cat <<'EOF'
## Summary
- Internal ALB skeleton with security group locked to RFC1918 (10.0.0.0/8). CF VPC Origin SG rule will be added by infra/cloudfront.
- Default 503 listener — per-component rules added by feature TF.

## Test plan
- [ ] Atlantis plan succeeds
- [ ] Atlantis apply creates ALB and SG
- [ ] ALB DNS name resolvable from within VPC

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Trigger Atlantis plan**

Comment on the PR: `atlantis plan`

Wait for Atlantis bot to respond. Expected plan: creates SG, ALB, listener, ACM cert (cert will be in pending validation state, may block apply until Task 11 creates DNS records).

If ACM validation blocks apply, you have two options:
- **(a)** Manually create the validation DNS record in Route 53 public zone (existing zone from multi-region-arch global/route53-zone)
- **(b)** Skip apply for now and resume after Task 11 sets up DNS

Choose (a) for forward progress.

- [ ] **Step 8: Atlantis apply**

Once plan looks clean, comment: `atlantis apply`

Expected: ALB created. Outputs available via `terraform output` (run by Atlantis).

- [ ] **Step 9: Merge PR**

```bash
gh pr merge --auto --squash
```

Expected: PR merged.

---

## Task 10: CloudFront + VPC Origin Terraform

**Files:**
- Create: `infra/cloudfront/backend.tf`
- Create: `infra/cloudfront/main.tf`
- Create: `infra/cloudfront/variables.tf`
- Create: `infra/cloudfront/outputs.tf`
- Modify: `infra/alb-internal/main.tf` — add SG rule for VPC Origin

PR flow (Atlantis).

- [ ] **Step 1: backend.tf**

Write `infra/cloudfront/backend.tf` (same pattern as alb-internal, different state key `production/aws-demo-platform/cloudfront/terraform.tfstate`).

- [ ] **Step 2: main.tf — VPC Origin + CF distribution for Atlantis**

Write `infra/cloudfront/main.tf`:
```hcl
data "terraform_remote_state" "alb_internal" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/alb-internal/terraform.tfstate"
    region = "us-east-1"
  }
}

# Cert for CF (must be in us-east-1)
resource "aws_acm_certificate" "cf" {
  provider                  = aws.us_east_1
  domain_name               = "atomai.click"
  subject_alternative_names = ["*.atomai.click"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

# Same caveat as alb-internal cert: DNS validation records must exist.

# ─────────────────────────────────────────────────────────────────────
# VPC Origin (CloudFront → Internal ALB)
# ─────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_vpc_origin" "alb" {
  vpc_origin_endpoint_config {
    name                   = "demo-platform-alb-internal"
    arn                    = data.terraform_remote_state.alb_internal.outputs.alb_arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "https-only"
    origin_ssl_protocols {
      quantity = 1
      items    = ["TLSv1.2"]
    }
  }
}

# ─────────────────────────────────────────────────────────────────────
# CloudFront Distribution — Atlantis
# ─────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "atlantis" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Atlantis (PR-driven Terraform)"
  aliases         = ["atlantis.atomai.click"]
  price_class     = "PriceClass_200"

  origin {
    domain_name = data.terraform_remote_state.alb_internal.outputs.alb_dns_name
    origin_id   = "alb-internal"

    vpc_origin_config {
      vpc_origin_id    = aws_cloudfront_vpc_origin.alb.id
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id       = "alb-internal"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled (AWS managed)
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer (AWS managed)
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cf.arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  restrictions { geo_restriction { restriction_type = "none" } }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
```

- [ ] **Step 3: outputs.tf**

```hcl
output "cf_vpc_origin_sg_id" {
  description = "Security group ID auto-created by CloudFront VPC Origin (used for Internal ALB ingress)"
  value       = aws_cloudfront_vpc_origin.alb.security_group_id
}
output "atlantis_cf_domain" {
  value = aws_cloudfront_distribution.atlantis.domain_name
}
```

- [ ] **Step 4: Add CF VPC Origin SG rule to alb-internal**

Edit `infra/alb-internal/main.tf` and add (at end):
```hcl
# CloudFront VPC Origin ingress rule (depends on infra/cloudfront state)
data "terraform_remote_state" "cloudfront" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/cloudfront/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_security_group_rule" "alb_cf_vpc_origin_ingress" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = data.terraform_remote_state.cloudfront.outputs.cf_vpc_origin_sg_id
  security_group_id        = aws_security_group.alb_internal.id
  description              = "CloudFront VPC Origin"
}
```

(Note: This creates a circular state-read between alb-internal and cloudfront. Order of apply: cloudfront → alb-internal SG rule update. Atlantis will plan both.)

- [ ] **Step 5: terraform fmt**

```bash
terraform fmt -recursive infra/cloudfront/ infra/alb-internal/
```

- [ ] **Step 6: PR + Atlantis plan + apply (in order)**

```bash
git checkout -b feature/cloudfront
git add infra/cloudfront/ infra/alb-internal/main.tf
git commit -m "infra(cloudfront): CF distribution for Atlantis + VPC Origin to Internal ALB

- VPC Origin pointing to Internal ALB (created in Task 9)
- CF distribution for atlantis.atomai.click (CachingDisabled, AllViewer)
- ACM cert in us-east-1 (CF requirement)
- Adds CF VPC Origin SG ingress rule to Internal ALB SG (cross-state-read)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feature/cloudfront
gh pr create --title "infra: CloudFront + VPC Origin (Atlantis)" --body "..."
```

Comment: `atlantis plan` → verify → `atlantis apply` → merge.

---

## Task 11: Route 53 Private Hosted Zone + public records

**Files:**
- Create: `infra/route53-private-zone/backend.tf`
- Create: `infra/route53-private-zone/main.tf`
- Create: `infra/route53-private-zone/variables.tf`
- Create: `infra/route53-private-zone/outputs.tf`

This adds split-horizon DNS: public records → CF, private records → Internal ALB.

- [ ] **Step 1: backend.tf** (same pattern; key `route53-private-zone`)

- [ ] **Step 2: main.tf**

Write `infra/route53-private-zone/main.tf`:
```hcl
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "alb_internal" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/alb-internal/terraform.tfstate"
    region = "us-east-1"
  }
}

data "terraform_remote_state" "cloudfront" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/aws-demo-platform/cloudfront/terraform.tfstate"
    region = "us-east-1"
  }
}

# Existing public zone (managed by multi-region-arch global/route53-zone)
data "aws_route53_zone" "public" {
  name         = "atomai.click."
  private_zone = false
}

# ─────────────────────────────────────────────────────────────────────
# Private Hosted Zone (attached to atomoh main VPC)
# ─────────────────────────────────────────────────────────────────────
resource "aws_route53_zone" "private" {
  name = "atomai.click"
  vpc {
    vpc_id = data.terraform_remote_state.shared.outputs.vpc_id
  }
  comment = "Split-horizon DNS — resolves internal services to Internal ALB"
}

# ─────────────────────────────────────────────────────────────────────
# Public records → CloudFront distributions
# (managed here for the AWS-Demo-Platform CFs only; mall.atomai.click etc.
# remain managed by multi-region-arch)
# ─────────────────────────────────────────────────────────────────────
resource "aws_route53_record" "atlantis_public" {
  zone_id = data.aws_route53_zone.public.zone_id
  name    = "atlantis.atomai.click"
  type    = "A"
  alias {
    name                   = data.terraform_remote_state.cloudfront.outputs.atlantis_cf_domain
    zone_id                = "Z2FDTNDATAQYW2" # CloudFront global hosted zone
    evaluate_target_health = false
  }
}

# ─────────────────────────────────────────────────────────────────────
# Private records → Internal ALB
# ─────────────────────────────────────────────────────────────────────
locals {
  internal_hosts = ["atlantis", "argocd", "admin", "admin-dev"]
}

resource "aws_route53_record" "internal" {
  for_each = toset(local.internal_hosts)
  zone_id  = aws_route53_zone.private.zone_id
  name     = "${each.key}.atomai.click"
  type     = "A"
  alias {
    name                   = data.terraform_remote_state.alb_internal.outputs.alb_dns_name
    zone_id                = data.terraform_remote_state.alb_internal.outputs.alb_zone_id
    evaluate_target_health = true
  }
}

# Public records for the rest (argocd, admin, admin-dev) — point to CF too,
# but their CF distributions are created by their feature TF (separate PRs).
# Track those records there.
```

- [ ] **Step 3: outputs.tf**

```hcl
output "private_zone_id" {
  value = aws_route53_zone.private.zone_id
}
```

- [ ] **Step 4: PR + apply**

```bash
git checkout -b feature/route53-private-zone
git add infra/route53-private-zone/
git commit -m "infra(route53): private hosted zone + atlantis records (split-horizon DNS)"
git push -u origin feature/route53-private-zone
gh pr create --title "infra: Route 53 PHZ + atlantis DNS" --body "..."
```

Atlantis plan → apply → merge.

- [ ] **Step 5: Verify DNS resolution**

From within VPC (e.g., from a hub cluster pod):
```bash
kubectl run -n default --rm -it dns-test --image=busybox --restart=Never -- nslookup atlantis.atomai.click
```
Expected: resolves to a 10.x.x.x address (Internal ALB).

From outside VPC (e.g., local laptop, if you can reach):
```bash
dig atlantis.atomai.click
```
Expected: resolves to CloudFront edge IPs.

---

## Task 12: Atlantis Target Group + Listener Rule + TGB

**Files:**
- Modify: `infra/alb-internal/main.tf` — add TG + listener rule for Atlantis
- Create: `k8s/system/atlantis/tgb.yaml`
- Modify: `k8s/system/atlantis/kustomization.yaml`

- [ ] **Step 1: Add Atlantis TG and listener rule**

Append to `infra/alb-internal/main.tf`:
```hcl
# Atlantis target group + listener rule
resource "aws_lb_target_group" "atlantis" {
  name        = "demo-platform-atlantis"
  port        = 4141
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "atlantis" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.atlantis.arn
  }

  condition {
    host_header { values = ["atlantis.atomai.click"] }
  }
}

output "atlantis_tg_arn" {
  value = aws_lb_target_group.atlantis.arn
}
```

- [ ] **Step 2: PR + apply for ALB TG**

```bash
git checkout -b feature/atlantis-alb-tg
git add infra/alb-internal/main.tf
git commit -m "infra(alb-internal): Atlantis target group + listener rule"
git push -u origin feature/atlantis-alb-tg
gh pr create ...
# atlantis plan + apply + merge
```

- [ ] **Step 3: Create TGB manifest**

After ALB apply succeeds, get the TG ARN:
```bash
cd infra/alb-internal
terraform output -raw atlantis_tg_arn
```

Write `k8s/system/atlantis/tgb.yaml` (substitute `<TG_ARN>`):
```yaml
apiVersion: elbv2.k8s.aws/v1beta1
kind: TargetGroupBinding
metadata:
  name: atlantis
  namespace: atlantis
spec:
  serviceRef:
    name: atlantis
    port: 80
  targetGroupARN: <TG_ARN>
  targetType: ip
```

- [ ] **Step 4: Add to kustomization**

Edit `k8s/system/atlantis/kustomization.yaml`:
```yaml
resources:
  - namespace.yaml
  - serviceaccount.yaml
  - external-secret.yaml
  - configmap.yaml
  - deployment.yaml
  - service.yaml
  - tgb.yaml
```

- [ ] **Step 5: Apply TGB**

```bash
kubectl apply -k k8s/system/atlantis/
```

- [ ] **Step 6: Verify TG healthy targets**

```bash
aws elbv2 describe-target-health \
  --target-group-arn <TG_ARN> \
  --region ap-northeast-2
```
Expected: at least 1 target in `healthy` state.

- [ ] **Step 7: End-to-end webhook test**

```bash
curl -v https://atlantis.atomai.click/healthz
```
Expected: 200 OK.

Update GitHub App webhook URL (if it was a placeholder earlier) to `https://atlantis.atomai.click/events`.

- [ ] **Step 8: Commit**

```bash
git add k8s/system/atlantis/tgb.yaml k8s/system/atlantis/kustomization.yaml
git commit -m "k8s(atlantis): TGB binding service to Internal ALB target group"
```

---

## Task 13: New ArgoCD installation with cluster-wide ignoreDifferences

**Files:**
- Migrate: `k8s/system/argocd/` from `multi-region-architecture/k8s/infra/argocd-korea/`
- Create: `k8s/system/argocd-cm-patch/argocd-cm.yaml`
- Modify: `k8s/system/argocd/kustomization.yaml`

This replaces the existing ArgoCD on hub cluster. Brief downtime acceptable ([[non-production-tolerance]]).

- [ ] **Step 1: Copy argocd-korea contents**

Run:
```bash
mkdir -p /tmp/argocd-fetch
for fname in kustomization.yaml namespace.yaml values.yaml argocd-server-nlb.yaml; do
  gh api "repos/Atom-oh/multi-region-architecture/contents/k8s/infra/argocd-korea/${fname}" \
    --jq '.content' | base64 -d > "/tmp/argocd-fetch/${fname}"
done

# apps/ subdirectory
mkdir -p /tmp/argocd-fetch/apps
gh api "repos/Atom-oh/multi-region-architecture/contents/k8s/infra/argocd-korea/apps" --jq '.[].name' | while read -r f; do
  gh api "repos/Atom-oh/multi-region-architecture/contents/k8s/infra/argocd-korea/apps/${f}" \
    --jq '.content' | base64 -d > "/tmp/argocd-fetch/apps/${f}"
done

# charts/ subdirectory (if exists)
gh api repos/Atom-oh/multi-region-architecture/contents/k8s/infra/argocd-korea/charts --jq '.[].name' 2>/dev/null | while read -r f; do
  # ... (recursively download)
  true
done

cp -r /tmp/argocd-fetch/* /home/atomoh/AWS-Demo-Platform/k8s/system/argocd/
```

- [ ] **Step 2: Remove the NLB-based exposure (we use TGB now)**

```bash
rm /home/atomoh/AWS-Demo-Platform/k8s/system/argocd/argocd-server-nlb.yaml
```

Edit `k8s/system/argocd/kustomization.yaml` and remove `- argocd-server-nlb.yaml`.

- [ ] **Step 3: argocd-cm patch — cluster-wide ignoreDifferences**

Write `k8s/system/argocd-cm-patch/argocd-cm-patch.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  resource.customizations.ignoreDifferences.apps_Deployment: |
    jsonPointers:
      - /spec/replicas
  resource.customizations.ignoreDifferences.apps_StatefulSet: |
    jsonPointers:
      - /spec/replicas
  resource.customizations.ignoreDifferences.autoscaling_HorizontalPodAutoscaler: |
    jsonPointers:
      - /spec/minReplicas
      - /spec/maxReplicas
```

Write `k8s/system/argocd-cm-patch/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - argocd-cm-patch.yaml
```

- [ ] **Step 4: Wire patch into argocd kustomization**

Edit `k8s/system/argocd/kustomization.yaml`. Add the cm patch via `patches`:
```yaml
patches:
  - path: ../argocd-cm-patch/argocd-cm-patch.yaml
    target:
      kind: ConfigMap
      name: argocd-cm
```

- [ ] **Step 5: Kustomize dry-run**

```bash
kustomize build k8s/system/argocd/ | grep -A 20 "kind: ConfigMap" | head -40
```
Expected: `argocd-cm` ConfigMap shows `resource.customizations.ignoreDifferences...` keys.

- [ ] **Step 6: Backup current ArgoCD state**

```bash
kubectl get applications -A -o yaml > /tmp/argocd-apps-backup.yaml
kubectl get appprojects -A -o yaml > /tmp/argocd-projects-backup.yaml
kubectl get secrets -n argocd -o yaml > /tmp/argocd-secrets-backup.yaml
echo "Backed up to /tmp/argocd-*-backup.yaml"
ls -lh /tmp/argocd-*-backup.yaml
```

- [ ] **Step 7: Delete old ArgoCD namespace**

```bash
kubectl delete namespace argocd --timeout=120s
```
Expected: namespace deleted. (If stuck on finalizers, force-delete per troubleshooting docs — out of scope here.)

- [ ] **Step 8: Apply new ArgoCD**

```bash
cd /home/atomoh/AWS-Demo-Platform
kubectl apply -k k8s/system/argocd/
```
Expected: namespace recreated, resources created.

- [ ] **Step 9: Wait for ArgoCD ready**

```bash
kubectl wait --for=condition=Available --timeout=300s deployment --all -n argocd
kubectl get pods -n argocd
```
Expected: all argocd-* deployments are Available.

- [ ] **Step 10: Get initial admin password**

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
echo
```

Save this for Step 11.

- [ ] **Step 11: Login and configure CLI**

Use port-forward (TGB not set up yet for ArgoCD — we'll do that in Task 14):
```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443 &
PF_PID=$!
sleep 3
argocd login localhost:8080 --insecure --username admin --password "<from step 10>"
argocd cluster list
kill $PF_PID 2>/dev/null
```
Expected: login succeeds; cluster list shows in-cluster.

- [ ] **Step 12: Generate API token for dashboard backend (future use, Stage 3)**

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443 &
PF_PID=$!
sleep 3
argocd account update-password --account dashboard-backend --new-password "dummy"  # placeholder; not used directly
# Actually for service account tokens (recommended over password):
TOKEN=$(argocd account generate-token --account admin)
echo "Token: $TOKEN"
# Save to AWS Secrets Manager:
aws secretsmanager create-secret \
  --name /demo-platform/argocd/admin-token \
  --secret-string "$TOKEN" \
  --region ap-northeast-2 || \
aws secretsmanager put-secret-value \
  --secret-id /demo-platform/argocd/admin-token \
  --secret-string "$TOKEN" \
  --region ap-northeast-2
kill $PF_PID 2>/dev/null
```

(If `account generate-token` for `admin` is disabled, edit `argocd-cm` to add `accounts.admin: apiKey, login` and re-apply.)

- [ ] **Step 13: Commit**

```bash
git add k8s/system/argocd/ k8s/system/argocd-cm-patch/
git commit -m "k8s(argocd): replace argocd-korea with hub argocd + cluster-wide ignoreDifferences

- Migrated from multi-region-architecture/k8s/infra/argocd-korea/
- Removed argocd-server-nlb.yaml (TGB pattern replaces NLB exposure)
- Added cluster-wide ignoreDifferences for Deployment/StatefulSet replicas
  and HPA min/max (supports HPA-2 on/off pattern)
- Old namespace destroyed and recreated (acceptable per non-production-tolerance)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: ArgoCD TGB + master-root Applications (App-of-Apps bootstrap)

**Files:**
- Modify: `infra/alb-internal/main.tf` — add argocd TG + rule
- Create: `k8s/system/argocd/tgb.yaml`
- Create: `argocd-apps/bootstrap/master-system-root.yaml`
- Create: `argocd-apps/bootstrap/master-tenants-root.yaml`

- [ ] **Step 1: ALB TG + rule for argocd**

Append to `infra/alb-internal/main.tf`:
```hcl
resource "aws_lb_target_group" "argocd_server" {
  name        = "demo-platform-argocd"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "argocd" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 110
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.argocd_server.arn
  }
  condition {
    host_header { values = ["argocd.atomai.click"] }
  }
}

output "argocd_tg_arn" {
  value = aws_lb_target_group.argocd_server.arn
}
```

PR → atlantis plan → apply → merge.

- [ ] **Step 2: ArgoCD CF distribution (similar to atlantis)**

Append to `infra/cloudfront/main.tf` a new `aws_cloudfront_distribution.argocd` resource (same structure as `atlantis`). PR → apply → merge.

- [ ] **Step 3: Public DNS record for argocd**

First, add to `infra/cloudfront/outputs.tf`:
```hcl
output "argocd_cf_domain" {
  value = aws_cloudfront_distribution.argocd.domain_name
}
```

Then append to `infra/route53-private-zone/main.tf`:
```hcl
resource "aws_route53_record" "argocd_public" {
  zone_id = data.aws_route53_zone.public.zone_id
  name    = "argocd.atomai.click"
  type    = "A"
  alias {
    name                   = data.terraform_remote_state.cloudfront.outputs.argocd_cf_domain
    zone_id                = "Z2FDTNDATAQYW2"  # CloudFront global hosted zone ID
    evaluate_target_health = false
  }
}
```

PR → apply → merge.

- [ ] **Step 4: ArgoCD TGB manifest**

Write `k8s/system/argocd/tgb.yaml`:
```yaml
apiVersion: elbv2.k8s.aws/v1beta1
kind: TargetGroupBinding
metadata:
  name: argocd-server
  namespace: argocd
spec:
  serviceRef:
    name: argocd-server
    port: 80
  targetGroupARN: <argocd_tg_arn from terraform output>
  targetType: ip
```

Add to `k8s/system/argocd/kustomization.yaml`.

Apply:
```bash
kubectl apply -k k8s/system/argocd/
```

- [ ] **Step 5: Verify https://argocd.atomai.click**

Open in browser: `https://argocd.atomai.click` → ArgoCD login UI.

- [ ] **Step 6: Configure GitHub repo credentials in ArgoCD**

Via UI or CLI:
```bash
argocd repo add https://github.com/Atom-oh/AWS-Demo-Platform.git \
  --username <github-user> --password <PAT-with-repo-scope>
argocd repo add https://github.com/Atom-oh/multi-region-architecture.git \
  --username <github-user> --password <PAT-with-repo-scope>
```

(Alternatively use Secrets Manager + ExternalSecret to provision repo credentials.)

- [ ] **Step 7: master-system-root Application**

Write `argocd-apps/bootstrap/master-system-root.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: master-system-root
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/AWS-Demo-Platform
    targetRevision: main
    path: argocd-apps/system
    directory: { recurse: false }
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

- [ ] **Step 8: master-tenants-root Application**

Write `argocd-apps/bootstrap/master-tenants-root.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: master-tenants-root
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/AWS-Demo-Platform
    targetRevision: main
    path: argocd-apps/tenants
    directory: { recurse: false }
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

- [ ] **Step 9: Apply bootstrap (one-time kubectl, future changes flow through)**

```bash
kubectl apply -f argocd-apps/bootstrap/master-system-root.yaml
kubectl apply -f argocd-apps/bootstrap/master-tenants-root.yaml
```

Expected: two Applications created in argocd namespace. They show "OutOfSync" or "Healthy" depending on whether `argocd-apps/system/` and `tenants/` directories have any content yet (currently empty).

- [ ] **Step 10: Commit**

```bash
git add k8s/system/argocd/tgb.yaml k8s/system/argocd/kustomization.yaml \
        argocd-apps/bootstrap/
git commit -m "argocd: TGB for ArgoCD UI + master-root App-of-Apps

- TGB binds argocd-server Service to ALB TG (created in alb-internal)
- master-system-root watches argocd-apps/system/ — auto-discovers
  Applications for hub system components (clickhouse-mgmt, prometheus,
  grafana, etc.)
- master-tenants-root watches argocd-apps/tenants/ — auto-discovers
  Applications for each external project repo (multi-region-mall etc.)

Adding a new project = drop a yaml in argocd-apps/tenants/, that's it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Migrate hub system components (clickhouse, prometheus, grafana, karpenter, runners, storageclass)

**Files:**
- Copy from multi-region-architecture/k8s/infra/* into k8s/system/* (per spec 5.1):
  - clickhouse-mgmt, prometheus-stack, grafana, karpenter-apne2-mgmt, actions-runner, runner-scheduler, storageclass
- Create one Application CR per component in `argocd-apps/system/`

- [ ] **Step 1: Copy each component**

For each of: `clickhouse-mgmt`, `prometheus-stack`, `grafana`, `karpenter-apne2-mgmt`, `actions-runner`, `runner-scheduler`, `storageclass`:

```bash
COMPONENT="clickhouse-mgmt"  # adjust per iteration
mkdir -p "/home/atomoh/AWS-Demo-Platform/k8s/system/${COMPONENT}"
# fetch files recursively
gh api "repos/Atom-oh/multi-region-architecture/contents/k8s/infra/${COMPONENT}" --jq '.[].name' | while read -r fname; do
  gh api "repos/Atom-oh/multi-region-architecture/contents/k8s/infra/${COMPONENT}/${fname}" \
    --jq '.content' | base64 -d > "/home/atomoh/AWS-Demo-Platform/k8s/system/${COMPONENT}/${fname}"
done
```

Repeat for each component.

- [ ] **Step 2: Verify file contents**

```bash
for c in clickhouse-mgmt prometheus-stack grafana karpenter-apne2-mgmt actions-runner runner-scheduler storageclass; do
  echo "=== $c ==="
  ls k8s/system/$c/
done
```

- [ ] **Step 3: For each component, create Application CR**

For `clickhouse-mgmt`:

`argocd-apps/system/clickhouse-mgmt.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: clickhouse-mgmt
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/AWS-Demo-Platform
    targetRevision: main
    path: k8s/system/clickhouse-mgmt
  destination:
    server: https://kubernetes.default.svc
    namespace: clickhouse  # adjust per component's namespace
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions:
      - CreateNamespace=true
```

Repeat for each component (prometheus-stack, grafana, karpenter-apne2-mgmt, actions-runner, runner-scheduler, storageclass), adjusting `name`, `path`, and `destination.namespace` accordingly.

- [ ] **Step 4: Commit**

```bash
git add k8s/system/clickhouse-mgmt k8s/system/prometheus-stack k8s/system/grafana \
        k8s/system/karpenter-apne2-mgmt k8s/system/actions-runner k8s/system/runner-scheduler \
        k8s/system/storageclass argocd-apps/system/
git commit -m "k8s(system): migrate hub system components from multi-region-architecture

Components copied:
- clickhouse-mgmt (will be extended with logs/traces schema in Task 16)
- prometheus-stack
- grafana
- karpenter-apne2-mgmt
- actions-runner
- runner-scheduler
- storageclass

Plus Application CRs in argocd-apps/system/ for ArgoCD master-system-root
to auto-discover and sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: Wait for ArgoCD to sync**

In ArgoCD UI (`argocd.atomai.click`), observe `master-system-root` → child Applications auto-appear → each syncs.

Verify with CLI:
```bash
argocd app list
argocd app wait master-system-root --health --timeout 600
```
Expected: all system Applications show Synced + Healthy.

Some may be Degraded if dependent resources are missing (e.g., grafana depends on prometheus). Resolve in order.

---

## Task 16: ClickHouse schema for logs/traces (replace Tempo)

**Files:**
- Create: `k8s/system/clickhouse-mgmt/schemas/otel.sql`
- Modify: `k8s/system/clickhouse-mgmt/` to include schema init via Job or initContainer

- [ ] **Step 1: Write OTel ClickHouse schema**

Write `k8s/system/clickhouse-mgmt/schemas/otel.sql`:
```sql
-- OpenTelemetry standard schemas for ClickHouse
-- Based on https://github.com/SigNoz/signoz/tree/develop/deploy/docker/clickhouse-setup

CREATE DATABASE IF NOT EXISTS otel;

-- Traces (spans)
CREATE TABLE IF NOT EXISTS otel.otel_traces (
    Timestamp        DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId          String        CODEC(ZSTD(1)),
    SpanId           String        CODEC(ZSTD(1)),
    ParentSpanId     String        CODEC(ZSTD(1)),
    TraceState       String        CODEC(ZSTD(1)),
    SpanName         LowCardinality(String) CODEC(ZSTD(1)),
    SpanKind         LowCardinality(String) CODEC(ZSTD(1)),
    ServiceName      LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    SpanAttributes   Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration         Int64 CODEC(ZSTD(1)),
    StatusCode       LowCardinality(String) CODEC(ZSTD(1)),
    StatusMessage    String CODEC(ZSTD(1)),
    Events Nested(Timestamp DateTime64(9), Name LowCardinality(String), Attributes Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    Links Nested(TraceId String, SpanId String, TraceState String, Attributes Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service ServiceName TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + INTERVAL 7 DAY  -- non-prod, short retention
SETTINGS index_granularity = 8192;

-- Logs
CREATE TABLE IF NOT EXISTS otel.otel_logs (
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt32 CODEC(ZSTD(1)),
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber Int32 CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service ServiceName TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree()
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, toUnixTimestamp(Timestamp))
TTL toDateTime(Timestamp) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;
```

- [ ] **Step 2: Create schema-init Job manifest**

Write `k8s/system/clickhouse-mgmt/schema-init.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: clickhouse-otel-schema
  namespace: clickhouse
data:
  otel.sql: |
    ${include otel.sql here verbatim}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: clickhouse-otel-schema-init
  namespace: clickhouse
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: schema-init
          image: clickhouse/clickhouse-server:24.3
          command:
            - sh
            - -c
            - "clickhouse-client --host clickhouse-mgmt --port 9000 --multiquery < /schema/otel.sql"
          volumeMounts:
            - { name: schema, mountPath: /schema }
      volumes:
        - name: schema
          configMap: { name: clickhouse-otel-schema }
```

(Alternative: bake schema into the Helm/Kustomize ClickHouse install. For now, Job is simpler.)

- [ ] **Step 3: Reference in kustomization**

Edit `k8s/system/clickhouse-mgmt/kustomization.yaml` to include `schema-init.yaml` (or restructure as needed based on what was copied).

- [ ] **Step 4: Commit + push (ArgoCD will sync)**

```bash
git add k8s/system/clickhouse-mgmt/
git commit -m "k8s(clickhouse-mgmt): OTel schema for logs and traces

Adds otel database with otel_traces and otel_logs tables.
Schema initialized via Job on first install.
7-day TTL (non-prod, short retention)."
git push
```

- [ ] **Step 5: Verify schema applied**

```bash
kubectl exec -n clickhouse statefulset/clickhouse-mgmt -- \
  clickhouse-client --query "SHOW TABLES FROM otel"
```
Expected:
```
otel_logs
otel_traces
```

---

## Task 17: OTel-collector + fluent-bit config update (ClickHouse, remove Tempo)

These are in `multi-region-architecture/k8s/infra/` — PR to that repo.

- [ ] **Step 1: Fetch current otel-collector config**

```bash
gh api repos/Atom-oh/multi-region-architecture/contents/k8s/infra/otel-collector/values.yaml \
  --jq '.content' | base64 -d > /tmp/otel-values.yaml
cat /tmp/otel-values.yaml
```

- [ ] **Step 2: Clone multi-region-architecture, modify, PR**

```bash
git clone https://github.com/Atom-oh/multi-region-architecture.git /tmp/multi-region-arch-edit
cd /tmp/multi-region-arch-edit
git checkout -b feature/otel-clickhouse-migration
```

Edit `k8s/infra/otel-collector/values.yaml` (or the appropriate file):
- Remove the `otlp/tempo` exporter
- Add the ClickHouse exporter:
```yaml
exporters:
  clickhouse:
    endpoint: tcp://clickhouse-mgmt.clickhouse.svc.cluster.local:9000?database=otel
    traces_table_name: otel_traces
    logs_table_name: otel_logs
    timeout: 5s
    sending_queue: { enabled: true, queue_size: 5000 }
    retry_on_failure: { enabled: true, initial_interval: 1s, max_interval: 30s, max_elapsed_time: 300s }
```

Update the pipelines:
```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]   # was: [otlp/tempo]
    logs:
      receivers: [otlp, filelog]
      processors: [batch]
      exporters: [clickhouse]
```

- [ ] **Step 3: Update fluent-bit output**

Edit `k8s/infra/fluent-bit/values.yaml` (or similar):
```yaml
config:
  outputs: |
    [OUTPUT]
        Name        opentelemetry
        Match       *
        Host        otel-collector.otel-collector.svc.cluster.local
        Port        4318
        Tls         off
```

(Routing fluent-bit logs through otel-collector → ClickHouse, rather than fluent-bit → ClickHouse directly. This consolidates the OTel/CH integration.)

- [ ] **Step 4: PR multi-region-arch**

```bash
git add k8s/infra/otel-collector k8s/infra/fluent-bit
git commit -m "observability: migrate exporters from Tempo to ClickHouse

- OTel collector traces/logs → ClickHouse (clickhouse-mgmt.clickhouse:9000/otel)
- Fluent-bit logs → OTel collector → ClickHouse
- Removes dependency on Tempo (which will be deleted in a follow-up)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feature/otel-clickhouse-migration
gh pr create --title "obs: migrate Tempo → ClickHouse"
```

- [ ] **Step 5: Atlantis plan (no terraform here, but k8s ArgoCD changes apply automatically on merge)**

Since this is k8s manifests not terraform, no Atlantis trigger needed. After PR merge, ArgoCD will sync changes to all clusters via existing shared-agents Applications (or be configured to do so in Task 19).

For Stage 1, manually verify after merge.

- [ ] **Step 6: Verify ClickHouse ingest**

Wait ~5 minutes after merge.
```bash
kubectl exec -n clickhouse statefulset/clickhouse-mgmt -- \
  clickhouse-client --query "SELECT count() FROM otel.otel_traces"
```
Expected: > 0 after a few minutes of running services.

---

## Task 18: Remove Tempo from multi-region-architecture

PR to multi-region-architecture.

- [ ] **Step 1: Branch + delete tempo dirs**

```bash
cd /tmp/multi-region-arch-edit
git checkout main && git pull
git checkout -b feature/remove-tempo
git rm -r k8s/infra/tempo k8s/infra/tempo-west
git rm -r terraform/modules/observability/tempo-storage || true
# Remove tempo module references from eks-mgmt and other consumers
grep -rl "tempo-storage" terraform/ | xargs sed -i '/tempo_storage/,/^}/d'
```

- [ ] **Step 2: Commit + PR**

```bash
git commit -m "observability: remove Tempo (replaced by ClickHouse)

Drops k8s/infra/tempo, k8s/infra/tempo-west, and tempo-storage Terraform module
references. ClickHouse handles traces now (per AWS-Demo-Platform Stage 1).

Non-prod: data loss OK."
git push -u origin feature/remove-tempo
gh pr create --title "obs: remove Tempo"
```

- [ ] **Step 3: Atlantis plan + apply (for terraform deletion)**

Comment on PR: `atlantis plan` → verify destruction is intended → `atlantis apply` → merge.

ArgoCD will then prune Tempo resources from all clusters.

---

## Task 19: multi-region-architecture argocd/ directory (App-of-Apps source for tenant)

PR to multi-region-architecture.

- [ ] **Step 1: Add argocd/ directory**

In `/tmp/multi-region-arch-edit`:
```bash
git checkout main && git pull
git checkout -b feature/argocd-tenant-app-of-apps
mkdir -p argocd
```

Write `argocd/shared-agents-hub.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: shared-agents-hub
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/multi-region-architecture
    targetRevision: main
    path: k8s/overlays/ap-northeast-2-mgmt  # adjust if no such overlay; use direct k8s/infra paths combined
  destination:
    server: https://kubernetes.default.svc  # hub itself
    namespace: kube-system  # adjust per overlay
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

(Adjust `path` to the actual overlay or kustomize entry point that aggregates external-secrets, fluent-bit, otel-collector, keda for the hub cluster.)

Write `argocd/shared-agents-az-a.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: shared-agents-az-a
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/multi-region-architecture
    targetRevision: main
    path: k8s/overlays/ap-northeast-2-az-a-infra  # adjust per actual overlay
  destination:
    server: <az-a cluster API URL — registered in ArgoCD as remote cluster>
    namespace: kube-system
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

Write `argocd/shared-agents-az-c.yaml` similar to az-a.

Write `argocd/workloads-apne2-az-a.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: workloads-apne2-az-a
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/multi-region-architecture
    targetRevision: main
    path: k8s/overlays/ap-northeast-2-az-a
  destination:
    server: <az-a cluster API URL>
    namespace: default
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

Write `argocd/workloads-apne2-az-c.yaml` similar.

- [ ] **Step 2: Register spoke clusters in hub ArgoCD**

```bash
# Get kubeconfig for each spoke
aws eks update-kubeconfig --name mall-apne2-az-a --region ap-northeast-2 --alias az-a
aws eks update-kubeconfig --name mall-apne2-az-c --region ap-northeast-2 --alias az-c

# Add to hub ArgoCD (via port-forward or direct internal ALB)
argocd cluster add az-a --label region=ap-northeast-2 --label role=workload
argocd cluster add az-c --label region=ap-northeast-2 --label role=workload
argocd cluster list
```
Expected: hub + az-a + az-c clusters listed.

Update the `destination.server` URLs in the YAMLs from Step 1 to match what `argocd cluster list` shows.

- [ ] **Step 3: Commit + PR**

```bash
cd /tmp/multi-region-arch-edit
git add argocd/
git commit -m "argocd: tenant App-of-Apps source for hub-managed sync

5 Applications for ap-northeast-2 region:
- shared-agents-hub, shared-agents-az-a, shared-agents-az-c
- workloads-apne2-az-a, workloads-apne2-az-c

Pointed to by AWS-Demo-Platform/argocd-apps/tenants/multi-region-mall.yaml
(App-of-Apps pattern). US clusters not included (out of scope per spec)."
git push -u origin feature/argocd-tenant-app-of-apps
gh pr create --title "argocd: tenant App-of-Apps for ap-northeast-2"
```

Merge.

---

## Task 20: Register multi-region-mall tenant in AWS-Demo-Platform

**Files:**
- Create: `argocd-apps/tenants/multi-region-mall.yaml`
- Create: `projects/multi-region-mall.yaml`
- Create: `accounts.yaml` (skeleton)

- [ ] **Step 1: tenant root Application**

Write `argocd-apps/tenants/multi-region-mall.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: tenant-multi-region-mall
  namespace: argocd
  finalizers: [resources-finalizer.argocd.argoproj.io]
spec:
  project: default
  source:
    repoURL: https://github.com/Atom-oh/multi-region-architecture
    targetRevision: main
    path: argocd
    directory: { recurse: false }
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

- [ ] **Step 2: project metadata**

Write `projects/multi-region-mall.yaml`:
```yaml
name: multi-region-mall
github:
  repo: Atom-oh/multi-region-architecture
  branch: main
description: Multi-region MSA showcase (shopping mall)
account: atomoh-main
display: { category: showcase }

resources:
  - type: argocd-app
    application: workloads-apne2-az-a
    cluster: az-a
    workload_selector: { namespace: default }
    hpa_handling: scale_to_one
  - type: argocd-app
    application: workloads-apne2-az-c
    cluster: az-c
    workload_selector: { namespace: default }
    hpa_handling: scale_to_one

  # Korea data layer — always-on
  - type: rds
    db_identifier: mall-apne2-aurora
    always_on: true
  - type: dynamodb
    table_names: []  # populate as needed
    always_on: true
  - type: elasticache
    cluster_id: mall-apne2-valkey
    always_on: true

urls:
  demo: https://mall.atomai.click
```

- [ ] **Step 3: accounts.yaml skeleton**

Write `accounts.yaml`:
```yaml
accounts:
  - name: atomoh-main
    account_id: "<ATOMOH_MAIN_ACCOUNT_ID>"
    region: ap-northeast-2
    roles:
      operator:
        arn: "arn:aws:iam::<ATOMOH_MAIN_ACCOUNT_ID>:role/DemoPlatformOperator"
        external_id_secret: /demo-platform/external-ids/atomoh-main/operator
      terraformer:
        arn: "arn:aws:iam::<ATOMOH_MAIN_ACCOUNT_ID>:role/DemoPlatformTerraformer"
        external_id_secret: /demo-platform/external-ids/atomoh-main/terraformer
  # Friend accounts added in Task 22
```

Substitute `<ATOMOH_MAIN_ACCOUNT_ID>` with the real account ID.

- [ ] **Step 4: Commit**

```bash
git add argocd-apps/tenants/multi-region-mall.yaml projects/multi-region-mall.yaml accounts.yaml
git commit -m "register multi-region-mall as platform tenant

- argocd-apps/tenants/multi-region-mall.yaml — root App pointing to
  multi-region-architecture/argocd/
- projects/multi-region-mall.yaml — metadata for dashboard (Stage 3)
- accounts.yaml — atomoh-main only for now; friends added in onboarding"
git push
```

- [ ] **Step 5: ArgoCD auto-discovers (verify)**

```bash
argocd app list | grep -E 'tenant|workload|shared'
```
Expected: `tenant-multi-region-mall` Application appears (created by `master-tenants-root`). Sub-Applications (shared-agents-*, workloads-*) appear shortly after.

Run:
```bash
argocd app wait tenant-multi-region-mall --health --timeout 300
```

---

## Task 21: Prometheus remote_write from spoke to hub

- [ ] **Step 1: Enable remote_write receiver on hub Prometheus**

In `k8s/system/prometheus-stack/values.yaml` (or wherever the kube-prometheus-stack is configured):
```yaml
prometheus:
  prometheusSpec:
    enableRemoteWriteReceiver: true
    # ... existing config
```

Commit + push to AWS-Demo-Platform. ArgoCD syncs.

Verify:
```bash
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  promtool check config /etc/prometheus/config_out/prometheus.env.yaml
```

- [ ] **Step 2: Configure spoke Prometheus remote_write**

In multi-region-arch, edit each spoke's prometheus config (likely in `k8s/services/observability/` or per-overlay):
```yaml
remoteWrite:
  - url: http://prometheus-kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090/api/v1/write
    # NOTE: cross-cluster requires public endpoint. Use:
    # url: https://prometheus-internal.atomai.click/api/v1/write
    # And ensure split-horizon DNS + ALB rule (or direct VPC peering for cross-cluster traffic).
    queueConfig:
      maxSamplesPerSend: 10000
      capacity: 100000
```

For cross-cluster: hub Prometheus must be reachable from spoke clusters. Add a TG + listener rule for prometheus-internal.atomai.click, and add private DNS record (split-horizon).

PR + apply.

- [ ] **Step 3: Verify metrics**

After ~10 minutes:
```bash
# Query hub Prometheus for spoke metric
kubectl exec -n monitoring prometheus-kube-prometheus-stack-prometheus-0 -c prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=up{cluster=~"az-a|az-c"}' | head -50
```
Expected: returns data points from spoke clusters.

---

## Task 22: Friend account onboarding (documentation + 1-2 actual setups)

**Files:**
- Create: `docs/onboarding/friend-account-setup.md`

- [ ] **Step 1: Write onboarding guide**

Write `docs/onboarding/friend-account-setup.md`:

```markdown
# Friend Account Onboarding

Setup required in each target AWS account to enable AWS Demo Platform management.

## Prerequisites
- AWS account admin access
- A pre-shared **ExternalId** value provided by atomoh (over secure channel — Signal/encrypted email)

## Step 1: Create operator role (limited runtime access)

Save the following as `demo-platform-operator-role.json`:

\```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::<ATOMOH_MAIN_ACCOUNT_ID>:role/DashboardEcsTaskRole-dev"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "<EXTERNAL_ID_FROM_ATOMOH>"
      }
    }
  }]
}
\```

Then:
\```bash
aws iam create-role \
  --role-name DemoPlatformOperator \
  --assume-role-policy-document file://demo-platform-operator-role.json

aws iam put-role-policy \
  --role-name DemoPlatformOperator \
  --policy-name DemoPlatformOperatorPerms \
  --policy-document file://demo-platform-operator-perms.json
\```

Where `demo-platform-operator-perms.json` is:

\```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECSControl",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices", "ecs:UpdateService",
        "ecs:ListServices", "ecs:ListTasks"
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
      "Sid": "DescribeOnlyForAlwaysOnResources",
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
\```

## Step 2: Create terraformer role (broad infra access, for Atlantis)

Same pattern but with broader perms and different ExternalId:

\```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::<ATOMOH_MAIN_ACCOUNT_ID>:role/AtlantisIRSARole"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "<TERRAFORMER_EXTERNAL_ID>"
      }
    }
  }]
}
\```

Attach AWS managed `PowerUserAccess` policy:
\```bash
aws iam attach-role-policy \
  --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
\```

## Step 3: Notify atomoh

Send to atomoh (securely):
- Your AWS account ID
- Confirmation that both roles are created with the agreed ExternalIds

atomoh will then add your entry to `accounts.yaml` and verify assume-role works.

## Verification (atomoh-side)

\```bash
aws sts assume-role \
  --role-arn arn:aws:iam::<FRIEND_ACCOUNT>:role/DemoPlatformOperator \
  --role-session-name verify \
  --external-id <FRIEND_EXTERNAL_ID>
\```

Expected: returns temporary credentials.
```

- [ ] **Step 2: Generate ExternalIds for atomoh-main + first friend**

```bash
for account in atomoh-main friend-A; do
  for role in operator terraformer; do
    ext_id=$(openssl rand -hex 16)
    aws secretsmanager create-secret \
      --name "/demo-platform/external-ids/${account}/${role}" \
      --secret-string "$ext_id" \
      --region ap-northeast-2 \
      --description "ExternalId for ${account} ${role} role" \
      || aws secretsmanager put-secret-value \
        --secret-id "/demo-platform/external-ids/${account}/${role}" \
        --secret-string "$ext_id" \
        --region ap-northeast-2
    echo "${account}/${role}: $ext_id"
  done
done
```

Save the ExternalIds for sharing with friends.

- [ ] **Step 3: Set up atomoh-main's own DemoPlatformOperator + DemoPlatformTerraformer**

Apply the same role setup (from the docs) but for atomoh's main account. The trust principal is the same (DashboardEcsTaskRole + AtlantisIRSARole).

```bash
# Create DemoPlatformOperator in atomoh main account (placeholder — DashboardEcsTaskRole doesn't exist yet,
# created in Stage 3. For Stage 1, only DemoPlatformTerraformer with Atlantis trust is needed for Atlantis
# to manage atomoh-main account.)
```

For Stage 1 we only need `DemoPlatformTerraformer` in atomoh-main, trusted by `AtlantisIRSARole`. The Operator role is Stage 2/3 use.

```bash
EXT_ID=$(aws secretsmanager get-secret-value --secret-id /demo-platform/external-ids/atomoh-main/terraformer --query SecretString --output text --region ap-northeast-2)

cat > /tmp/terraformer-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/AtlantisIRSARole"},
    "Action": "sts:AssumeRole",
    "Condition": {"StringEquals": {"sts:ExternalId": "$EXT_ID"}}
  }]
}
EOF

aws iam create-role \
  --role-name DemoPlatformTerraformer \
  --assume-role-policy-document file:///tmp/terraformer-trust.json

aws iam attach-role-policy \
  --role-name DemoPlatformTerraformer \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

- [ ] **Step 4: Onboard 1 friend (real)**

Send onboarding guide to a friend. They follow steps 1-3. Once they confirm, verify assume-role from atlantis pod:

```bash
kubectl exec -n atlantis deploy/atlantis -- \
  aws sts assume-role \
    --role-arn arn:aws:iam::<FRIEND_ACCT>:role/DemoPlatformTerraformer \
    --role-session-name atlantis-verify \
    --external-id <FRIEND_TERRAFORMER_EXT_ID>
```
Expected: returns temp credentials. (Confirms assume-role chain works.)

- [ ] **Step 5: Update accounts.yaml**

Append friend entry to `accounts.yaml`, commit, push.

```bash
cd /home/atomoh/AWS-Demo-Platform
# Edit accounts.yaml to add friend-A entry
git add accounts.yaml docs/onboarding/
git commit -m "docs: friend account onboarding guide + register first friend"
git push
```

---

## Task 23: DoD verification + retrospective

- [ ] **Step 1: Run through DoD checklist (spec Section 5.6)**

```
[ ] AWS-Demo-Platform repo에 디렉토리 구조 + 이전 파일들 머지
[ ] Atlantis가 PR `atlantis plan` 코멘트로 동작
[ ] ArgoCD UI가 `argocd.atomai.click` 접근 가능
[ ] argocd-cm에 ignoreDifferences 적용
[ ] root admin token Secrets Manager 저장 (/demo-platform/argocd/admin-token)
[ ] multi-region-mall ap-northeast-2 spoke 워크로드가 hub ArgoCD에서 정상 sync
[ ] multi-region-architecture mgmt 관련 디렉토리 삭제 PR 머지
[ ] 친구 계정 1~2개 DemoPlatformTerraformer 셋업 + assume-role 동작 확인
[ ] ClickHouse에 logs/traces 적재 확인
[ ] Prometheus에 hub + 1개 이상 spoke metrics 수집 확인
```

For each item, run the verification command and confirm.

- [ ] **Step 2: Retrospective note**

Write `docs/superpowers/retrospectives/2026-XX-XX-stage-1.md` (replace XX-XX with completion date):
```markdown
# Stage 1 Retrospective

## What went well
- ...

## What was harder than expected
- ...

## Decisions made during execution
- ...

## Items to revisit in Stage 4
- ...

## Open from spec OQ list (still pending)
- OQ-5 Karpenter NodePool review
- OQ-2 tempo placement (now moot since deleted)
- ...
```

- [ ] **Step 3: Tag v0.1.0**

```bash
cd /home/atomoh/AWS-Demo-Platform
git tag -a v0.1.0 -m "Stage 1 complete: infra migration + Atlantis + CloudFront VPC Origins + new ArgoCD"
git push --tags
```

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/retrospectives/
git commit -m "docs: Stage 1 retrospective"
git push
```

---

## Self-Review Notes (post-write)

This plan covers spec Sections 1.3 (Stage 1), 2.5 (network), 2.8 (Atlantis), 4.2 (argocd-cm ignoreDifferences), 5.1-5.6 (migration), 7.1 (resolved OQs).

**Spec items deferred to later stages:**
- Cognito User Pool — Stage 3 (when dashboard frontend exists)
- DynamoDB tables — Stage 2 (lifecycle controller storage)
- Dashboard ECS — Stage 3
- DashboardEcsTaskRole — Stage 2

**Spec items handled outside this plan:**
- multi-region-architecture's `argocd-server-nlb.yaml` removal — implicit in NLB deletion of old argocd-korea
- Detailed Karpenter NodePool review (OQ-5) — left for Stage 4

**Known issues to address during execution:**
- ACM certificate DNS validation chicken-and-egg: alb-internal cert may need manual DNS record creation in route53 public zone before Task 9 apply completes. Documented in Task 9 Step 7.
- Cross-state circular reference between alb-internal and cloudfront for VPC Origin SG ingress. Applied in two terraform actions; documented in Task 10 Step 4.
- Atlantis bootstrap (Tasks 4-8) is non-Atlantis terraform. All subsequent terraform changes go through Atlantis PRs (starting Task 9).
- Schema-init Job for ClickHouse (Task 16) runs once on first deploy. Subsequent re-runs are idempotent (`CREATE TABLE IF NOT EXISTS`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-stage-1-infra-migration.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration
2. **Inline Execution** — execute in this session, batch with checkpoints

Which approach?
