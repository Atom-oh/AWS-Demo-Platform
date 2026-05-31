# infra/dashboard-ecs

Dashboard runtime (Stage 2 Phase 4, dev). ECS Fargate cluster `demo-platform-dev`:
- **api** service (desiredCount=1) — Fastify; behind the Internal ALB `demo-platform-api-dev` TG → CF `admin-api-dev.atomai.click`. Reaches `/health` 200 with no external deps (prod entry wires no deps, JWT skipPaths /health).
- **worker** service (desiredCount=**0**, scaffolded OFF).

- **State key**: `production/aws-demo-platform/dashboard-ecs/terraform.tfstate`
- Images: `…/demo-platform/{api,worker}:main-latest` (built linux/amd64 → tasks pinned `X86_64`).
- Refs via remote_state: shared (vpc/subnets), alb-internal (`dashboard_api_tg_arn`, `alb_sg_id`), iam (`task_role_arn`, `exec_role_arn`).
- `ignore_changes = [task_definition, desired_count]` — image rolled by GHA / count out-of-band.

## Enabling the worker (deferred)
desiredCount=0 because the worker entry calls `loadWorkerEnv()` (requires GITHUB_PAT + ARGOCD_ADMIN_TOKEN) and `loadProjects(PROJECTS_DIR)` / accounts.yaml. Before scaling to 1:
1. Populate `/demo-platform/dev/github/pat` and `/demo-platform/argocd/admin-token`.
2. Bake `projects/*.yaml` + `accounts.yaml` into the worker image (Dockerfile COPY) or mount them — currently NOT in the image.
Then `aws ecs update-service --service demo-platform-worker-dev --desired-count 1`.
