# ADR-006: ARM64/Graviton for ECS images, built natively on a self-hosted ARM runner

## Status
Accepted (Stage 2/3, 2026-06-03)

## Context

The api, worker, and frontend run on ECS Fargate. A Fargate task's
`runtime_platform.cpu_architecture` must match the container image's platform — a
mismatch fails the task with `exec format error`. We must choose the CPU
architecture for all three images and how arm64 images get built in CI.

```mermaid
flowchart LR
  GHA[GHA job on aws-demo-platform-arm runner] -->|docker build --platform=linux/arm64 native| ECR[(ECR :main-latest)]
  ECR -->|pull| F[Fargate task cpu_architecture=ARM64]
```

## Options Considered

### Option 1: amd64 / X86_64 everywhere
- **Pros**: the default; widest base-image coverage.
- **Cons**: forgoes Graviton price/performance.

### Option 2: arm64 / Graviton, built natively on a self-hosted ARM runner
- **Pros**: Graviton cost/performance; a native build is fast with no emulation; the `aws-demo-platform-arm` ARC scale-set (scale-to-zero on the hub) already exists.
- **Cons**: requires the self-hosted ARM runner; base images must be multi-arch (`node:20-alpine` is).

### Option 3: arm64 via QEMU emulation on GitHub-hosted amd64 runners
- **Pros**: no self-hosted runner.
- **Cons**: very slow builds; needs `buildx`/binfmt setup.

## Decision

**Option 2.** All ECS task definitions set `cpu_architecture = "ARM64"`, and CI
builds `--platform=linux/arm64` natively on the `aws-demo-platform-arm`
self-hosted runner. `node:20.16-alpine` is multi-arch, so the Dockerfiles are
unchanged. The image platform and the task `cpu_architecture` are kept in
lockstep — flipping one without the other crashes tasks (`exec format error`).
The migration landed mid-Stage-3 (PR #16 for api/worker), after which the
frontend was aligned to arm64 to match the rest of the cluster.

## Consequences

### Positive
- Graviton cost/performance; fast native builds (no QEMU); a consistent single-architecture cluster.

### Negative
- Image platform and task `cpu_architecture` are coupled — a partial change breaks task launch with `exec format error`.
- CI depends on the self-hosted ARM runner being available (ARC scale-to-zero on the hub cluster).
- A rollout must pin the new ARM64 task-def revision on `update-service` — a bare `--force-new-deployment` keeps the old revision. Migrating an in-flight branch (amd64 → an arm64 `main`) needs a merge plus an arch flip in the same change.

## References
- `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml` (`--platform=linux/arm64`, `runs-on: aws-demo-platform-arm`)
- `infra/dashboard-ecs/main.tf` (`runtime_platform.cpu_architecture = "ARM64"`)
- `docs/runbooks/arm64-graviton-migration.md`; PR #16
