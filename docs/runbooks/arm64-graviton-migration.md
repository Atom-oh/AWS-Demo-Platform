# Runbook: api/worker arm64 (Graviton) migration & rollback

Covers the one-time switch of the `demo-platform-{api,worker}-dev` ECS Fargate
services from `X86_64` (amd64 images) to `ARM64` (native arm64 / Graviton),
introduced in PR #16.

## Why order matters

The ECS services declare `ignore_changes = [task_definition, desired_count]`
(`infra/dashboard-ecs/main.tf`). Consequences:

- `atlantis apply` **registers a new ARM64 task-definition revision** but does
  **not** move the running service onto it — the service stays on its current
  revision until an explicit, out-of-band `aws ecs update-service`.
- The image roll is **manual** (`aws ecs update-service`); there is no GHA step
  that does it. `backend-ci.yml` only builds and pushes images to ECR.
- Both task defs reference the floating `:main-latest` tag
  (`infra/dashboard-ecs/data.tf`), which `push-images` overwrites with arm64 on
  merge to `main`.

The failure mode: if the service runs a **X86_64** revision while `:main-latest`
has already become **arm64**, the task fails to start with `exec format error`.
`api` is LIVE in dev, so this is real (brief downtime is acceptable per the
non-production policy, but avoid the broken interim state).

## Deploy sequence (do in this exact order)

1. **Merge PR** to `main`.
   → `backend-ci` `push-images` builds natively on the `aws-demo-platform-arm`
   self-hosted runner and pushes `sha-<sha>` + overwrites `:main-latest` as
   **arm64** for both `api` and `worker`.

2. **Apply Terraform** (registers the ARM64 task-def revisions):
   ```
   # in PR comment
   atlantis apply -d infra/dashboard-ecs
   ```
   No service disruption yet — services still on the old X86_64 revision.

3. **Move each service onto the new ARM64 revision** (this is the cutover):
   ```bash
   CLUSTER=demo-platform-dev
   for svc in api worker; do
     NEW_REV=$(aws ecs describe-task-definition \
       --task-definition demo-platform-$svc-dev \
       --query 'taskDefinition.taskDefinitionArn' --output text)
     aws ecs update-service --cluster "$CLUSTER" \
       --service "demo-platform-$svc-dev" \
       --task-definition "$NEW_REV" --force-new-deployment
   done
   ```
   > ⚠️ Do **not** run a bare `--force-new-deployment` without `--task-definition`
   > pointing at the new ARM64 revision. That re-deploys the **old X86_64**
   > revision against the now-arm64 `:main-latest` → `exec format error`.

4. **Verify** the api comes back healthy:
   ```bash
   curl -fsS https://admin-api-dev.atomai.click/health   # expect 200
   aws ecs describe-services --cluster demo-platform-dev \
     --services demo-platform-api-dev \
     --query 'services[0].deployments[].{status:status,taskDef:taskDefinition,running:runningCount}'
   ```

`worker` runs at `desiredCount=0`, so its arch change is inert until it is
scaled up (see `infra/dashboard-ecs/CLAUDE.md`); just ensure an arm64 image
exists before scaling it to 1.

## Rollback

Roll back by **immutable `sha-` tag**, never by `:main-latest` — once migrated,
`:main-latest` is arm64, so a X86_64 task def must not pull it.

1. Find the last known-good amd64 image tag (a `sha-<sha>` pushed before the
   migration) in ECR `demo-platform/{api,worker}`.
2. Revert `infra/dashboard-ecs/main.tf` `cpu_architecture` to `X86_64` and point
   `data.tf` `*_image` at that `sha-` tag (not `:main-latest`); `atlantis apply`.
3. `aws ecs update-service ... --task-definition <reverted X86_64 rev> --force-new-deployment`.

## Operational dependency

CI for the backend now depends on the `aws-demo-platform-arm` self-hosted runner
(ARC scale-to-zero on the `mall-apne2-mgmt` hub). If that runner pool is down,
`backend-ci` (lint-test + push-images) cannot run. Check ARC:
```
kubectl config current-context   # must be mall-apne2-mgmt
kubectl -n actions-runner-system get pods | grep aws-demo-platform-arm
```
