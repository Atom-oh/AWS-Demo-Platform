# ECR repositories for the Lifecycle Controller images (dev env).
# Spec §4.1.6. NOTE: the spec names a single `demo-platform/backend` repo, but
# Phase 1 produces TWO images (api + worker, separate Dockerfiles), so we create
# one repo per image. MUTABLE chosen so the `main-latest` moving tag works
# alongside immutable `<sha>` tags (ECR mutability is per-repo, not per-tag).

locals {
  # api + worker (Stage 2) and frontend (Stage 3 Next.js standalone image).
  # NOTE: actions-runner-claude ECR 레포는 이미 존재하므로 여기서 관리하지 않는다 —
  #       for_each 에 넣으면 import 없이 create 를 시도해 atlantis apply 가
  #       RepositoryAlreadyExistsException 으로 실패한다. TF 흡수는 별도 PR에서
  #       `terraform import` 선행 + lifecycle tagPrefix(sha) 정렬과 함께 처리.
  repos = ["demo-platform/api", "demo-platform/worker", "demo-platform/frontend"]
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.repos)
  name                 = each.value
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 30 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["main", "v", "sha"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = { type = "expire" }
      }
    ]
  })
}
