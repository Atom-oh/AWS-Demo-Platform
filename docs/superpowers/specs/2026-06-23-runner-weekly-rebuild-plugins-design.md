# Weekly runner rebuild and baked plugins — historical design

**Date:** 2026-06-23, with a 2026-06-23b review-tooling extension.
**Original status:** approved, implementing. **Reconciled:** 2026-09-13.
The schedule/image work exists; several original choices were superseded.
Full installation commands and diagnostics remain in Git history.

## Intent and trade-offs

Rebuild the ARM64 review-runner image weekly, bake Claude/Codex/Kiro tooling and
plugins, and eliminate manual first-run setup. Replace the self-referencing
`FROM actions-runner-claude:latest`: rebuilding on its own output accumulated
layers and froze the underlying runner. The official Actions runner container
was chosen over a from-scratch AL2023 runner to reuse its agent/OS dependencies.

The design retained manual dispatch and added Saturday 18:00 UTC builds. Push
follows a successful build, so an install failure before push leaves the published
tag unchanged. This is not proof of runtime compatibility or automatic rollback
after a successful but defective image build.

Three plugins were selected: Codex, code-review and GitHub. Direct CLI calls
remained the panel execution path; plugin installation was not equivalent to
headless MCP authentication. Antigravity was removed because its tested login
path required interactive OAuth. The shared `claude-runner` service account also
needed its own Pod Identity association; node credentials were not a substitute.

## Current source and superseded requirements

- [Runner workflow](../../../.github/workflows/runner-image.yml) builds with
  `--pull --platform=linux/arm64`, then publishes `latest` and a SHA tag through
  OIDC. A schedule declaration is not evidence of a successful weekly run.
- [Dockerfile](../../../docker/actions-runner-claude/Dockerfile) defaults to the
  upstream runner and installs vendor-current CLIs. The draft's fixed versions
  and checksum pins are **not current controls**. Codex companion configuration
  may warn and continue, so plugin installation does not prove setup succeeded.
- [Panel calls](../../../scripts/pr-review/run-panel.sh) use `kiro-cli chat`
  without the proposed `--v3`; that path was abandoned after catalog mismatches.
  Current jobs comprise Codex, two Kiro slots and Claude self-review plus a chair,
  not the original Kiro-x3 roster. [Review documentation](../../pr-review.md)
  owns models, credentials and coverage limitations.
- [Pod Identity configuration](../../../infra/eks-mgmt/main.tf) includes
  `claude-runner`. [Pull-through-cache infrastructure](../../../infra/ecr/pull-through-cache.tf)
  separates secret-slot creation from optional rule activation; configuration
  presence does not establish populated credentials or a successful import.
- Runner image policy is not uniform: many review manifests use `latest`, while
  the [ai-trader review runner](../../../argocd-apps/system/appset-helm-runner-claude-arm-ai-trader-web.yaml)
  pins a CLI image digest after PR #105. Do not assume every scale set follows a
  rebuilt tag.

Build-time CLI help checks and plugin listings are limited evidence. A new runner
must register and complete meaningful model responses; a green image job alone
cannot prove the review panel works. Future changes follow
[ADR-016](../../decisions/ADR-016-multi-ai-pr-review-panel.md) and the
[release runbook](../../runbooks/review-and-release.md).
