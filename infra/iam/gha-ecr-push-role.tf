# GitHubActionsEcrPush-dev — role assumed by GitHub Actions (OIDC) on pushes to
# main, to push the api/worker images to ECR. Spec §5.3 (Phase 3).
# Trust restricted to this repo's main branch.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "gha_ecr_assume" {
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
      values   = ["repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "gha_ecr_push" {
  name               = "demo-platform-gha-ecr-push"
  assume_role_policy = data.aws_iam_policy_document.gha_ecr_assume.json
}

data "aws_iam_policy_document" "gha_ecr_push" {
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      "arn:aws:ecr:${local.region}:${local.account_id}:repository/demo-platform/api",
      "arn:aws:ecr:${local.region}:${local.account_id}:repository/demo-platform/worker",
      "arn:aws:ecr:${local.region}:${local.account_id}:repository/demo-platform/frontend",
    ]
  }
}

resource "aws_iam_role_policy" "gha_ecr_push" {
  name   = "GitHubActionsEcrPushPermissions"
  role   = aws_iam_role.gha_ecr_push.id
  policy = data.aws_iam_policy_document.gha_ecr_push.json
}
