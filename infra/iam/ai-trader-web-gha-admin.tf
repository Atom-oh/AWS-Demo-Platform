# ai-trader-web-terraform-admin — role assumed by ai-trader-web's terraform.yml
# via GitHub Actions OIDC. AdministratorAccess so `terraform plan/apply` can
# manage IAM and any other resource in this account. Because it is admin, trust
# is pinned to the exact sub claims terraform.yml produces (no wildcard).
# Reuses data.aws_iam_openid_connect_provider.github from gha-ecr-push-role.tf.

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
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:Atom-oh/ai-trader-web:pull_request",        # plan job on PR
        "repo:Atom-oh/ai-trader-web:ref:refs/heads/main", # plan job on push to main
        "repo:Atom-oh/ai-trader-web:environment:prod",    # apply job (environment: prod)
      ]
    }
  }
}

resource "aws_iam_role" "ai_trader_web_gha_admin" {
  name               = "ai-trader-web-terraform-admin"
  assume_role_policy = data.aws_iam_policy_document.ai_trader_web_gha_admin_assume.json
}

resource "aws_iam_role_policy_attachment" "ai_trader_web_gha_admin" {
  role       = aws_iam_role.ai_trader_web_gha_admin.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
