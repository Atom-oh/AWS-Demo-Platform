# GitHub Actions OIDC roles for the Atom-oh/ai-trader-web repo's terraform.yml.
#
# Split by privilege because `terraform plan` executes provider plugins and
# `external`/data sources from the PR branch — so a plan job runs attacker-
# controllable code. Granting admin to the `pull_request` sub would let anyone
# who can open a PR run code with account-admin creds (ADR-012). So:
#
#   plan  (pull_request + push to main) -> ai-trader-web-terraform-plan  (ReadOnlyAccess)
#   apply (push to main only)           -> ai-trader-web-terraform-admin (AdministratorAccess)
#
# ai-trader-web uses local Terraform state (no remote backend block) and deploys
# into THIS account, so ReadOnlyAccess lets plan refresh its own resources — but
# it also exposes demo-platform's shared state + data account-wide, denied below.
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

# ReadOnlyAccess grants s3:Get* / dynamodb:GetItem+Scan account-wide, and this
# account hosts the SHARED platform-wide Terraform state (bucket + lock table,
# may contain plaintext secrets) plus the demo-platform Lifecycle Controller
# DynamoDB tables. Since the plan role is assumable by attacker-controlled PR-
# branch code (ADR-012), an explicit Deny on those closes the read-exfil path
# for demo-platform's data while leaving ai-trader-web's own resources readable
# (it deploys into this same account). secretsmanager:GetSecretValue / kms:Decrypt
# are already absent from ReadOnlyAccess, so ExternalId/secret paths are closed.
# NOTE: the state lock table + bucket live in us-east-1 (see backend.tf), not the
# ap-northeast-2 local.region, so the lock-table ARN is pinned to us-east-1.
data "aws_iam_policy_document" "ai_trader_web_gha_plan_deny_state" {
  statement {
    sid       = "DenyDemoPlatformStateBucket"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::multi-region-mall-terraform-state", "arn:aws:s3:::multi-region-mall-terraform-state/*"]
  }
  statement {
    sid     = "DenyDemoPlatformDynamo"
    effect  = "Deny"
    actions = ["dynamodb:*"]
    # `table/demo-platform-*` already covers the GSIs: an IAM resource wildcard
    # `*` matches any characters including `/`, so it spans the index ARN
    # `table/demo-platform-jobs-dev/index/gsi1` too (dynamodb:Query authorizes on
    # that index ARN). The explicit `/index/*` line is a defensive duplicate.
    resources = [
      "arn:aws:dynamodb:us-east-1:${local.account_id}:table/multi-region-mall-terraform-locks",
      "arn:aws:dynamodb:${local.region}:${local.account_id}:table/demo-platform-*",
      "arn:aws:dynamodb:${local.region}:${local.account_id}:table/demo-platform-*/index/*",
    ]
  }
  # Defense-in-depth: ReadOnlyAccess v187 does NOT include
  # secretsmanager:GetSecretValue (only Describe*/List*/GetResourcePolicy), so
  # secret VALUES — operator/terraformer ExternalId, GitHub PAT, ArgoCD token,
  # cognito, the AI panel key — are already unreadable. This explicit Deny pins
  # that guarantee so a future AWS-managed-policy change can't silently open the
  # exfil path. Scoped to /demo-platform/* so ai-trader-web's own secrets (same
  # account) stay readable for plan.
  statement {
    sid       = "DenyDemoPlatformSecretValues"
    effect    = "Deny"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:/demo-platform/*"]
  }
  # demo-platform's CloudWatch logs (dashboard API request logs etc.) — scoped to
  # the /demo-platform/* namespace so ai-trader-web's own log groups (it deploys
  # into this same account) stay readable for its plan refresh. logs:* (not an
  # action list) blocks StartQuery + StartLiveTail, the log-group-scoped reads
  # ReadOnlyAccess also grants. (GetQueryResults has no resource-level scoping,
  # but StartQuery is the entry point and is denied, so the read is closed.)
  statement {
    sid       = "DenyDemoPlatformLogs"
    effect    = "Deny"
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/demo-platform/*"]
  }
  # demo-platform SQS job queue + DLQ (demo-platform-jobs-dev,
  # demo-platform-jobs-dlq-dev) — ReceiveMessage would expose in-flight Lifecycle
  # Controller job payloads. Wildcard covers both.
  statement {
    sid       = "DenyDemoPlatformSqs"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = ["arn:aws:sqs:${local.region}:${local.account_id}:demo-platform-*"]
  }
}

resource "aws_iam_role_policy" "ai_trader_web_gha_plan_deny_state" {
  name   = "DenyDemoPlatformState"
  role   = aws_iam_role.ai_trader_web_gha_plan.id
  policy = data.aws_iam_policy_document.ai_trader_web_gha_plan_deny_state.json
}

# --- apply role: admin, gated on the main-branch sub (IAM-enforced) -----------

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
    # Gate admin on the main-branch sub, NOT on an `environment:prod` sub. An
    # environment sub would delegate the branch gate to GitHub environment
    # protection, which this repo's billing plan cannot enforce (no required
    # reviewers / branch policy — HTTP 422). `ref:refs/heads/main` IS the sub
    # (a real IAM condition key, unlike the non-evaluable `ref` claim), so IAM
    # itself restricts admin to code already on main — gated by main's branch
    # protection + PR review. Same model as demo-platform-gha-ecr-push.
    # NOTE: the ai-trader-web apply job must therefore run on push to main /
    # workflow_dispatch on main WITHOUT an `environment:` binding (an environment
    # binding would change the sub to environment:prod and break this trust).
    # Not further pinned to a job_workflow_ref: like `ref`, that OIDC claim is not
    # exposed by AWS STS as an IAM condition key, so it cannot be a condition
    # here. The main-branch sub already restricts assume to code merged to main
    # (gated by branch protection + review); job-level pinning, if wanted, must be
    # done via GitHub sub customization on the ai-trader-web side.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:Atom-oh/ai-trader-web:ref:refs/heads/main"]
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
