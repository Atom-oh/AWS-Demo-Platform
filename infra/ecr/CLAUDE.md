# infra/ecr

Image repos for the Lifecycle Controller (Stage 2): `demo-platform/api` and
`demo-platform/worker`. Scan-on-push; lifecycle = expire untagged after 7d,
keep last 30 tagged.

- **State key**: `production/aws-demo-platform/ecr/terraform.tfstate`
- **Outputs**: `repository_urls` (map), `api_repository_url`, `worker_repository_url`
- MUTABLE mutability (ECR is per-repo, not per-tag) so the `main-latest` moving tag
  coexists with immutable `<sha>` tags. Two repos — spec named one `demo-platform/backend`
  but Phase 1 ships two images. Atlantis project `ecr`.
