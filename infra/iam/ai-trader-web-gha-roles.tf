# GitHub Actions OIDC roles for the Atom-oh/ai-trader-web repo's terraform.yml.
#
# Split by privilege because `terraform plan` executes provider plugins and
# `external`/data sources from the PR branch — so a plan job runs attacker-
# controllable code. Granting admin to the `pull_request` sub would let anyone
# who can open a PR run code with account-admin creds, bypassing the
# environment:prod approval gate entirely (ADR-012). So:
#
#   plan  (pull_request + push to main)  -> ai-trader-web-terraform-plan  (ReadOnlyAccess)
#   apply (environment:prod, gated)      -> ai-trader-web-terraform-admin (AdministratorAccess)
#
# ai-trader-web uses local Terraform state (no remote backend block), so the
# plan role needs no S3/DynamoDB state permissions — ReadOnlyAccess covers the
# read-only refresh a plan performs.
#
# Reuses data.aws_iam_openid_connect_provider.github from gha-ecr-push-role.tf.
# Naming: `ai-trader-web-*` (not the `demo-platform-*` prefix) intentionally —
# these are external-repo roles paired with the pre-existing out-of-band
# `ai-trader-web-gha-deploy` role, kept in the same namespace for that repo.

# --- plan role: read-only, PR + main -----------------------------------------

data "aws_iam_policy_document" "ai_trader_web_gha_plan_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:Atom-oh/ai-trader-web:pull_request",        # plan job on PR
        "repo:Atom-oh/ai-trader-web:ref:refs/heads/main", # plan job on push to main
      ]
    }
  }
}

resource "aws_iam_role" "ai_trader_web_gha_plan" {
  name               = "ai-trader-web-terraform-plan"
  assume_role_policy = data.aws_iam_policy_document.ai_trader_web_gha_plan_assume.json
}

resource "aws_iam_role_policy_attachment" "ai_trader_web_gha_plan" {
  role       = aws_iam_role.ai_trader_web_gha_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# ReadOnlyAccess grants s3:Get*/dynamodb:GetItem account-wide, and this account
# hosts the SHARED, platform-wide Terraform state bucket + lock table (state can
# contain plaintext secrets). Since the plan role is assumable by attacker-
# controlled PR-branch code (ADR-012) and ai-trader-web uses LOCAL state, it has
# no legitimate need for demo-platform's state — deny it explicitly to close the
# exfiltration path. (secretsmanager:GetSecretValue/kms:Decrypt are already
# absent from ReadOnlyAccess, so those paths are closed by omission.)
data "aws_iam_policy_document" "ai_trader_web_gha_plan_deny_state" {
  statement {
    sid       = "DenyDemoPlatformStateBucket"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::multi-region-mall-terraform-state", "arn:aws:s3:::multi-region-mall-terraform-state/*"]
  }
  statement {
    sid       = "DenyDemoPlatformStateLock"
    effect    = "Deny"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${local.region}:${local.account_id}:table/multi-region-mall-terraform-locks"]
  }
}

resource "aws_iam_role_policy" "ai_trader_web_gha_plan_deny_state" {
  name   = "DenyDemoPlatformState"
  role   = aws_iam_role.ai_trader_web_gha_plan.id
  policy = data.aws_iam_policy_document.ai_trader_web_gha_plan_deny_state.json
}

# --- apply role: admin, gated on the prod environment -------------------------

data "aws_iam_policy_document" "ai_trader_web_gha_admin_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # environment:prod — the apply job's only trusted sub. GitHub environment
    # protection rules (required reviewers + deployment-branch restriction) on
    # ai-trader-web's `prod` environment are one gate; confirm they are set
    # (they live in the ai-trader-web repo settings, not this IaC).
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:Atom-oh/ai-trader-web:environment:prod"]
    }
    # Second gate at the IAM layer, not dependent on external-repo settings: the
    # OIDC token's `ref` claim is separate from `sub`, so we can AND it with the
    # environment sub. apply only fires on main push + workflow_dispatch from
    # main, so refs/heads/main is the only ref an apply job legitimately carries.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:ref"
      values   = ["refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "ai_trader_web_gha_admin" {
  name                 = "ai-trader-web-terraform-admin"
  assume_role_policy   = data.aws_iam_policy_document.ai_trader_web_gha_admin_assume.json
  max_session_duration = 7200 # 2h — long applies must not expire mid-run.
}

resource "aws_iam_role_policy_attachment" "ai_trader_web_gha_admin" {
  role       = aws_iam_role.ai_trader_web_gha_admin.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
