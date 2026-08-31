# ECR pull-through cache for ghcr.io.
#
# Purpose: pull the runner-image build's base (`ghcr.io/actions/actions-runner`) via in-account ECR.
#   - Removes the self-reference: the Dockerfile FROM points at the upstream official image, not our own output (:latest).
#   - Benefits: rate-limit avoidance, in-region speed/availability, and in-account digest preservation.
#
# The ghcr PTC requires credentials (a GitHub PAT, scope: read:packages). The Secrets Manager secret name
# must start with `ecr-pullthroughcache/` for ECR to be able to access it. The value is injected manually (TF only manages the slot).

variable "enable_ghcr_pull_through_cache_rule" {
  description = "Create the ghcr.io ECR pull-through cache rule. Keep false until ecr-pullthroughcache/ghcr contains a valid GitHub PAT."
  type        = bool
  default     = false
}

resource "aws_secretsmanager_secret" "ghcr_pull_through" {
  name        = "ecr-pullthroughcache/ghcr"
  description = "GitHub PAT (read:packages) for ECR pull-through cache of ghcr.io. Value injected manually."
}

# ⚠️ Apply-order dependency: when creating the PTC rule, ECR actually validates the credentials
#   against upstream (ghcr). So the rule is disabled by default. Recommended procedure:
#     1) Run a standard atlantis apply to create only this secret slot.
#     2) Inject the value:
#        aws secretsmanager put-secret-value --secret-id ecr-pullthroughcache/ghcr \
#          --secret-string '{"username":"<github-user>","accessToken":"<PAT read:packages>"}'
#     3) Turn on `enable_ghcr_pull_through_cache_rule=true` in a follow-up apply to create the PTC rule.

resource "aws_ecr_pull_through_cache_rule" "ghcr" {
  count = var.enable_ghcr_pull_through_cache_rule ? 1 : 0

  ecr_repository_prefix = "ghcr"
  upstream_registry_url = "ghcr.io"
  credential_arn        = aws_secretsmanager_secret.ghcr_pull_through.arn
}

# apply: post-#38 runner infra (Atlantis). See PR body for sequence.
