# Secrets Manager slots for the Lifecycle Controller (dev). Spec §4.1.7.
# We create empty containers; values are populated out-of-band (CLI/console):
#   - github/pat        : a GitHub PAT for repo discovery (before worker runs)
#   - argocd/admin-token: ArgoCD API token for the worker's ArgoCD controller
#   - cognito/*         : filled in Phase 4 once the User Pool exists
#
# The operator/terraformer external-ids are NOT managed here — they were created
# out-of-band in Stage 1 and already hold values.
#
# recovery_window_in_days = 0 → non-prod, immediate delete on destroy.

locals {
  slots = [
    "/demo-platform/dev/github/pat",
    "/demo-platform/argocd/admin-token",
    "/demo-platform/dev/cognito/user-pool-id",
    "/demo-platform/dev/cognito/app-client-id",
  ]
}

resource "aws_secretsmanager_secret" "slot" {
  for_each                = toset(local.slots)
  name                    = each.value
  recovery_window_in_days = 0
}
