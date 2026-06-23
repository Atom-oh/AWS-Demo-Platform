# infra/ecr

Image repos: `demo-platform/api` and `demo-platform/worker` (Stage 2 Lifecycle
Controller) and `demo-platform/frontend` (Stage 3 Next.js standalone dashboard).
Scan-on-push; lifecycle = expire untagged after 7d, keep last 30 tagged.

- **State key**: `production/aws-demo-platform/ecr/terraform.tfstate`
- **Outputs**: `repository_urls` (map), `api_repository_url`, `worker_repository_url`, `frontend_repository_url`
- MUTABLE mutability (ECR is per-repo, not per-tag) so the `main-latest` moving tag
  coexists with immutable `<sha>` tags. Three repos (api/worker/frontend) — the spec
  named one `demo-platform/backend` but the build ships separate images. Atlantis project `ecr`.
- **Pull-through cache (`pull-through-cache.tf`)** — ghcr.io PTC rule (prefix `ghcr`) so the
  runner-image build pulls its base `ghcr.io/actions/actions-runner` via in-account ECR
  (no self-referential FROM). Requires a GitHub PAT (read:packages) in Secrets Manager
  `ecr-pullthroughcache/ghcr` (slot managed here; **value injected manually**). The
  `demo-platform-gha-ecr-push` role needs `ghcr/*` import perms (see infra/iam).
