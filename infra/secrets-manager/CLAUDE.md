# infra/secrets-manager

Empty Secrets Manager containers for the dashboard (dev) and hub Grafana. Containers only —
values populated out-of-band:
- `/demo-platform/dev/github/pat` — GitHub PAT for repo discovery
- `/demo-platform/argocd/admin-token` — ArgoCD API token for the worker
- `/demo-platform/dev/cognito/{user-pool-id,app-client-id}` — filled in Phase 4
- `/demo-platform/grafana/admin` — JSON `username`/`password` for the persisted
  Grafana administrator and its Helm/sidecar Secret references. Values are
  populated out-of-band; this separate resource has a 7-day recovery window.

- **State key**: `production/aws-demo-platform/secrets-manager/terraform.tfstate`
- Dashboard `aws_secretsmanager_secret.slot` resources use
  `recovery_window_in_days = 0` (non-prod, immediate delete); the separate
  Grafana administrator container uses 7 days.
- Scope is the dashboard and Grafana slots above; `/demo-platform/external-ids/*` lives elsewhere —
  those were created out-of-band in Stage 1 and already hold values. Atlantis project
  `secrets-manager`.
