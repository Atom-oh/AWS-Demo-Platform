# infra/ecr

Image repos: `demo-platform/api` and `demo-platform/worker` (Stage 2 Lifecycle
Controller) and `demo-platform/frontend` (Stage 3 Next.js standalone dashboard).
Scan-on-push; lifecycle = expire untagged after 7d, keep last 30 tagged.

- **State key**: `production/aws-demo-platform/ecr/terraform.tfstate`
- **Outputs**: `repository_urls` (map), `api_repository_url`, `worker_repository_url`, `frontend_repository_url`
- MUTABLE mutability (ECR is per-repo, not per-tag) so the `main-latest` moving tag
  coexists with immutable `<sha>` tags. Three repos (api/worker/frontend) — the spec
  named one `demo-platform/backend` but the build ships separate images. Atlantis project `ecr`.
- **Pull-through cache (`pull-through-cache.tf`)** — optional ghcr.io PTC support
  (prefix `ghcr`) for the runner-image base `ghcr.io/actions/actions-runner`
  (no self-referential FROM). Standard Atlantis apply creates only the Secrets Manager
  slot `ecr-pullthroughcache/ghcr`; inject the GitHub PAT value (`read:packages`) manually,
  then set `enable_ghcr_pull_through_cache_rule=true` in a follow-up apply to create the
  ECR rule. `ecr-pullthroughcache/` is an AWS-required prefix and an intentional exception
  to `/demo-platform/...` naming. The `demo-platform-gha-ecr-push` role needs
  `ghcr/actions/*` import perms (see infra/iam).
