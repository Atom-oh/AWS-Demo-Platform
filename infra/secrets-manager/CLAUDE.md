# infra/secrets-manager

Empty Secrets Manager slots for the dashboard (Stage 2, dev). Containers only —
values populated out-of-band:
- `/demo-platform/dev/github/pat` — GitHub PAT for repo discovery
- `/demo-platform/argocd/admin-token` — ArgoCD API token for the worker
- `/demo-platform/dev/cognito/{user-pool-id,app-client-id}` — filled in Phase 4

- **State key**: `production/aws-demo-platform/secrets-manager/terraform.tfstate`
- `recovery_window_in_days = 0` (non-prod, immediate delete).
- Does NOT manage `/demo-platform/external-ids/*` — those were created out-of-band in
  Stage 1 and already hold values. Atlantis project `secrets-manager`.
