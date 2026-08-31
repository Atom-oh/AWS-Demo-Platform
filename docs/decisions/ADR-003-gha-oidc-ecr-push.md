# ADR-003: GitHub Actions OIDC for ECR image push (no long-lived keys)

## Status
Accepted (Stage 2 Phase 3, 2026-05-31)

## Context

`backend-ci.yml` must push the api/worker images to ECR on merge to `main`. The
runner needs AWS credentials with ECR push permission. We did not want long-lived
IAM access keys stored as GitHub secrets.

```mermaid
flowchart LR
  GH[GitHub Actions main push] -->|OIDC token sub=repo:...:ref:refs/heads/main| STS[AWS STS]
  STS -->|AssumeRoleWithWebIdentity| R[demo-platform-gha-ecr-push]
  R -->|ecr:PutImage etc.| ECR[(ECR api/worker)]
```

## Options Considered

### Option 1: Long-lived IAM access key in GitHub secrets
- **Pros**: trivial to set up.
- **Cons**: standing credential to rotate/leak; broad blast radius if exposed.

### Option 2: GitHub OIDC → short-lived role assumption
- **Pros**: no stored secret; tokens are short-lived; trust scoped to a specific repo + branch ref.
- **Cons**: needs an IAM OIDC provider + a role with a precise trust condition.

## Decision

**Option 2.** Reuse the existing `token.actions.githubusercontent.com` OIDC
provider. Role `demo-platform-gha-ecr-push` trusts only
`repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main` with `aud=sts.amazonaws.com`,
and is scoped to ECR push on the two `demo-platform/{api,worker}` repos.
Images are tagged `sha-<sha12>` + `main-latest`; ECR is MUTABLE so `main-latest`
moves; the lifecycle policy's `sha` prefix expires old SHA tags (keep last 30).

## Consequences

### Positive
- No long-lived AWS keys in GitHub; trust is branch-scoped.
- `id-token: write` is granted only to the push job, not the whole workflow.

### Negative
- MUTABLE repo means `main-latest` (and a same-SHA rebuild) can be overwritten — a
  `concurrency` guard serializes pushes per ref to avoid races.
- Trust is repo+branch only; environment-scoped tokens (`:environment:dev`) are a
  future tightening.

## References
- `infra/iam/gha-ecr-push-role.tf`, `.github/workflows/backend-ci.yml`
- `infra/ecr/main.tf` (lifecycle + MUTABLE rationale)
