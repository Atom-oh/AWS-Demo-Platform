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
      # runner-image.yml 이 빌드해 push 하는 러너 이미지(누락돼 있던 권한).
      "arn:aws:ecr:${local.region}:${local.account_id}:repository/actions-runner-claude",
    ]
  }
  # ECR pull-through cache(ghcr) — runner-image 빌드가 베이스(ghcr/actions/actions-runner)를
  # 최초 pull 할 때 ECR 가 캐시 repo 를 생성하고 upstream 에서 import 한다. 그 동작에 필요한 권한.
  statement {
    sid    = "EcrPullThroughGhcr"
    effect = "Allow"
    actions = [
      "ecr:CreateRepository",
      "ecr:BatchImportUpstreamImage",
      "ecr:TagResource",
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      "arn:aws:ecr:${local.region}:${local.account_id}:repository/ghcr/*",
    ]
  }
}

resource "aws_iam_role_policy" "gha_ecr_push" {
  name   = "GitHubActionsEcrPushPermissions"
  role   = aws_iam_role.gha_ecr_push.id
  policy = data.aws_iam_policy_document.gha_ecr_push.json
}
