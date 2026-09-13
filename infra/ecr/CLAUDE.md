# ECR

`main.tf` manages only `demo-platform/api`, `demo-platform/worker` and
`demo-platform/frontend`, with scan-on-push. State key:
`production/aws-demo-platform/ecr/terraform.tfstate`; Atlantis project: `ecr`.
`outputs.tf` exports the repository URL map and individual runtime URLs.

Repositories are `MUTABLE` for moving `main-latest` tags. CI also publishes
`sha-<12-character-commit>` tags; their immutability is a convention, not an ECR
guarantee. The lifecycle JSON expires untagged images after seven days and defines
a tagged count rule of 30 with `tagPrefixList = ["main", "v", "sha"]`. Inspect
the actual selector/policy before claiming a particular image is retained.

The existing `actions-runner-claude` repository is explicitly excluded from
Terraform ownership here. Before adopting it or adding a lifecycle policy, inventory
consumers and all tags on retained digests. Preserve the ai-trader-web compatibility
image under the [runner retention procedure](../../docs/runbooks/ai-trader-review-runner.md);
do not assume the runtime repositories' policies apply to it.

`pull-through-cache.tf` creates the `ecr-pullthroughcache/ghcr` secret container.
Populate the GitHub `read:packages` credential out-of-band before enabling
`enable_ghcr_pull_through_cache_rule=true` in a reviewed follow-up apply. The default
is false. That secret prefix is AWS-required. The image build must also select the
cache as its base; a cache rule alone does not change the Dockerfile's upstream
`ghcr.io/actions/actions-runner` default.
