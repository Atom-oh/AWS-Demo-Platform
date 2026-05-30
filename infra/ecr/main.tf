# ECR repositories for the Lifecycle Controller images (dev env).
# Spec §4.1.6. NOTE: the spec names a single `demo-platform/backend` repo, but
# Phase 1 produces TWO images (api + worker, separate Dockerfiles), so we create
# one repo per image. MUTABLE chosen so the `main-latest` moving tag works
# alongside immutable `<sha>` tags (ECR mutability is per-repo, not per-tag).

locals {
  repos = ["demo-platform/api", "demo-platform/worker"]
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
