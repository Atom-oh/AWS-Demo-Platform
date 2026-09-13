---
name: release
description: Prepare versioned releases using the project's review and deployment contracts.
---

# Release

Follow `docs/runbooks/review-and-release.md` and affected module/runbook commands.
A tag records a release; it does not automatically deploy production.

1. Identify the intended commit, changes since the previous tag and affected
   services. Preserve unrelated work and inspect actual required branch checks.
2. Run relevant deterministic checks, then resolve Critical/Major findings and
   verify AI review on the latest HEAD. Honor existing authorization for the
   correction/push/merge loop; do not bypass failed checks or missing coverage.
3. Choose semver from compatibility impact. Move relevant `[Unreleased]` entries
   into the release section in English only and maintain comparison links.
4. When release publication is authorized, create/push the annotated `vX.Y.Z` tag.
   Report its commit and result. ArgoCD follows configured Git revisions; ECS
   needs an explicit selected task-definition rollout. Neither follows a tag
   merely because it exists.
5. Validate affected runtime behavior when deployment is in scope. A global list
   of unrelated OutOfSync Applications is not by itself a release blocker.
