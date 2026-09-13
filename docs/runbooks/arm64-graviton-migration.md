# ARM64 migration and architecture rollback

PR #16 introduced the API/worker migration from X86_64 to ARM64 in June 2026.
That migration is historical; current Terraform declares ARM64 for API, worker
and frontend. Old task revisions, image tags and worker counts are not a live
inventory. Use the [rollout procedure](dashboard-public-deploy-execution.md) for
normal deployments and the [ECS guide](../../infra/dashboard-ecs/CLAUDE.md) for
source ownership.

## Architecture boundary

`infra/dashboard-ecs/main.tf` ignores service `task_definition` and `desired_count`
drift. Terraform can register a new revision without updating a service. Backend
CI publishes native ARM64 `sha-<12-character-commit>` and `main-latest` images;
it does not roll services. `data.tf` still selects the floating `main-latest` tag.

An X86_64 task revision pulling an ARM64 image can fail with `exec format error`.
Updating a floating image tag before moving every affected service creates a
restart hazard. The original rollout's cached running image was not protection
against a later restart. Treat image architecture and task architecture as one
reviewed selection; preserve a known-good image digest for recovery.

## Migration or recovery sequence

1. Inventory actual service revisions/counts and each running image digest.
   Preserve the previous compatible task definition and image. Initial Terraform
   counts (including worker zero) do not establish current counts.
2. Build/publish and inspect the intended architecture. Review/apply the matching
   task definitions through Atlantis:

   ```text
   atlantis plan -d infra/dashboard-ecs
   atlantis apply -d infra/dashboard-ecs
   ```

3. Select an explicit reviewed `family:revision` or ARN. Do not select the newest
   family revision implicitly, or use a bare `--force-new-deployment` while the
   old revision and moving tag disagree. Example for one service, with variables
   set from the reviewed deployment record:

   ```bash
   : "${SERVICE_NAME:?Set the intended demo-platform service}"
   : "${TASK_DEFINITION:?Set the reviewed family:revision or ARN}"
   aws ecs describe-task-definition --region ap-northeast-2 \
     --task-definition "$TASK_DEFINITION" \
     --query 'taskDefinition.{arn:taskDefinitionArn,platform:runtimePlatform,images:containerDefinitions[].image}'
   aws ecs update-service --region ap-northeast-2 \
     --cluster demo-platform-dev --service "$SERVICE_NAME" \
     --task-definition "$TASK_DEFINITION" --force-new-deployment
   aws ecs wait services-stable --region ap-northeast-2 \
     --cluster demo-platform-dev --services "$SERVICE_NAME"
   ```

4. Verify running task architecture/digests, target health, API auth and public
   behavior as described in the rollout runbook. A zero-count service has no
   running task to validate; record that limitation and verify it when enabled.

## Rollback

Select a known-good task definition and retained image digest with matching
architecture. The revision's `containerDefinitions[].image` must reference that
verified digest; register a reviewed revision if none exists. Selecting an older
revision that still names `main-latest` does not restore its original image.
SHA tags in these mutable ECR repositories are not enforced immutable.
Do not point an X86_64 rollback definition at an ARM64 `main-latest` image.

A cross-architecture rollback requires a reviewed Terraform change to both
`cpu_architecture` and the selected image, then an explicit service update to the
registered revision. Normal rollback stays ARM64. Preserve intended counts and
verify the resulting tasks; reverting source alone does not roll ECS.

## Build dependency

Backend lint/test and image publication run on the `aws-demo-platform-arm` ARC
fleet; frontend lint/build uses GitHub-hosted Ubuntu while its image job uses
that ARM64 fleet. Check the explicitly verified hub context:

```bash
kubectl --context mall-apne2-mgmt -n actions-runner-system get pods \
  -l actions.github.com/scale-set-name=aws-demo-platform-arm
```

An idle scale-to-zero fleet may have no runner Pod. Inspect ARC listeners,
queued jobs and Pod events before concluding that the fleet is unavailable.
