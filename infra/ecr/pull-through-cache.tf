# ECR pull-through cache for ghcr.io.
#
# 목적: runner-image 빌드의 베이스(`ghcr.io/actions/actions-runner`)를 in-account ECR 경유로 가져온다.
#   - self-reference 제거: Dockerfile FROM 이 우리 출력(:latest)이 아니라 upstream 공식 이미지.
#   - 레이트리밋/인리전 속도/가용성 이점, 다이제스트 in-account 보존.
#
# ghcr PTC 는 자격증명이 필요하다(GitHub PAT, scope: read:packages). Secrets Manager 시크릿 이름은
# 반드시 `ecr-pullthroughcache/` 로 시작해야 ECR 가 접근할 수 있다. 값은 수동 주입(TF는 슬롯만 관리).

variable "enable_ghcr_pull_through_cache_rule" {
  description = "Create the ghcr.io ECR pull-through cache rule. Keep false until ecr-pullthroughcache/ghcr contains a valid GitHub PAT."
  type        = bool
  default     = false
}

resource "aws_secretsmanager_secret" "ghcr_pull_through" {
  name        = "ecr-pullthroughcache/ghcr"
  description = "GitHub PAT (read:packages) for ECR pull-through cache of ghcr.io. Value injected manually."
}

# ⚠️ apply 순서 의존성: ECR 는 PTC 규칙 생성 시 자격증명을 upstream(ghcr)에 실제로 검증한다.
#   따라서 규칙은 기본 비활성이다. 권장 절차:
#     1) 표준 atlantis apply 로 이 시크릿 슬롯만 생성한다.
#     2) 값 주입:
#        aws secretsmanager put-secret-value --secret-id ecr-pullthroughcache/ghcr \
#          --secret-string '{"username":"<github-user>","accessToken":"<PAT read:packages>"}'
#     3) `enable_ghcr_pull_through_cache_rule=true` 를 후속 apply 에서 켜고 PTC 규칙을 생성한다.

resource "aws_ecr_pull_through_cache_rule" "ghcr" {
  count = var.enable_ghcr_pull_through_cache_rule ? 1 : 0

  ecr_repository_prefix = "ghcr"
  upstream_registry_url = "ghcr.io"
  credential_arn        = aws_secretsmanager_secret.ghcr_pull_through.arn
}

# apply: post-#38 runner infra (Atlantis). See PR body for sequence.
