# ECR repositories for the Lifecycle Controller images (dev env).
# Spec §4.1.6. NOTE: the spec names a single `demo-platform/backend` repo, but
# Phase 1 produces TWO images (api + worker, separate Dockerfiles), so we create
# one repo per image. MUTABLE chosen so the `main-latest` moving tag works
# alongside immutable `<sha>` tags (ECR mutability is per-repo, not per-tag).

locals {
  # api + worker (Stage 2) and frontend (Stage 3 Next.js standalone image).
  # NOTE: the actions-runner-claude ECR repo already exists, so it is not managed here —
  #       adding it to for_each would attempt a create without import, and atlantis apply
  #       would fail with RepositoryAlreadyExistsException. Absorbing it into TF will be
  #       handled in a separate PR, preceded by a `terraform import` plus alignment of the
  #       lifecycle tagPrefix(sha).
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
