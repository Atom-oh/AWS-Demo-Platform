# Public dashboard deployment — historical design

**Date:** 2026-06-03; architecture decision updated 2026-06-04 after PR #16.
**Reconciled:** 2026-09-13. The implementation exists; this record does not establish
live rollout. The original analysis and phase commands remain in Git history.

## Goal and decisions

Expose the dev dashboard at `admin-dev.atomai.click`, with Cognito login and
working resource restoration through the API/worker.

1. **ARM64:** the first draft assumed amd64 while PR #16 was pending. After the
   backend Graviton migration, frontend images/tasks aligned to ARM64. Old task
   revision numbers are dated observations, not rollout inputs.
2. **Same origin:** route dashboard `/api/*` directly to the API origin through
   CloudFront. The original `AllViewer` recommendation was wrong for the shared
   viewer hostname: both dashboard behaviors now use `AllViewerExceptHostHeader`
   with `CachingDisabled`. See [ADR-004](../../decisions/ADR-004-same-origin-cloudfront-dashboard.md).
3. **Access tokens:** PKCE uses a public SPA client; the API verifies access-token
   `username` and the admin allowlist. The internal adapter field is
   `cognito:username`, not the access-token claim. Frontend bypass does not bypass
   server auth. See [ADR-005](../../decisions/ADR-005-cognito-spa-auth-code-pkce.md).
4. **Retryable restoration:** partial on preserves saved data through `markError`;
   the API accepts retry from `error`.
5. **Resource identity:** restoration and progress use unique `stepKey` values so
   multiple resources of the same type do not collide.
6. **OIDC:** main-ref trust lets another workflow assume the publication role,
   but trust alone does not grant push to a new repository. The current policy
   explicitly includes frontend; see [ADR-003](../../decisions/ADR-003-gha-oidc-ecr-push.md).

## Delivery dependencies retained

The design separated worker restoration, real API dependencies, frontend image,
routing/runtime and browser login. ECR must exist before first push; required
secrets and images must exist before consumers roll. A changed task definition
needs an explicitly selected revision: a bare force-deploy retains the existing
revision. The original worker count of zero and target-resource inventory were
snapshots, not current operational facts.

Current code and limits live in [dashboard context](../../../dashboard/CLAUDE.md),
[frontend context](../../../dashboard/frontend/CLAUDE.md) and
[ADR-001](../../decisions/ADR-001-sqs-worker-for-async-jobs.md). Image publication,
ECS rollout and public TLS/login/resource verification remain separate steps in
the [release runbook](../../runbooks/review-and-release.md).
