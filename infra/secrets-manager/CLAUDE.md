# infra/secrets-manager

Secrets Manager containers for the dashboard (dev) and hub Grafana. This module
does not write values; `infra/cognito` publishes public Cognito IDs, while credential
values are populated out-of-band:
- `/demo-platform/dev/github/pat` — GitHub PAT for repo discovery
- `/demo-platform/argocd/admin-token` — ArgoCD API token for the worker
- `/demo-platform/dev/cognito/{user-pool-id,app-client-id}` — filled by `infra/cognito`
- `/demo-platform/grafana/admin` — JSON `username`/`password` for the persisted
  Grafana administrator and its Helm/sidecar Secret references. Values are
  populated out-of-band; this separate resource has a 7-day recovery window.

- **State key**: `production/aws-demo-platform/secrets-manager/terraform.tfstate`
- Dashboard `aws_secretsmanager_secret.slot` resources use
  `recovery_window_in_days = 0` (non-prod, immediate delete); the separate
  Grafana administrator container uses 7 days.
- `/demo-platform/external-ids/*` is provisioned separately; container/value
  readiness must be verified, not inferred from this module. Atlantis project:
  `secrets-manager`.
- Apply/populate the producer before starting a consumer. Grafana also requires
  agreement with its persisted database credential; see the
  [rotation procedure](../../docs/runbooks/grafana-private-ingress.md).
