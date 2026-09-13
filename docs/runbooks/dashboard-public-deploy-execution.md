# Public dashboard rollout

Scope: `admin-dev.atomai.click`, API/worker/frontend on ECS cluster
`demo-platform-dev` in `ap-northeast-2`. June 2026 PR #18/#19 observations described
an X86_64-to-ARM64 cutover; their revisions, populated-secret claims and webhook
status are historical. Resolve current values for each rollout. See the
[ECS guide](../../infra/dashboard-ecs/CLAUDE.md) and
[review/release procedure](review-and-release.md).

## Preflight and dependencies

Verify `aws sts get-caller-identity`, current service revisions/counts, retained
rollback images and matching ARM64 task/image architecture. Check Cognito IDs,
GitHub/ArgoCD secret readiness, ExternalId access and the intended `ADMIN_USERNAMES`.
The frontend's `NEXT_PUBLIC_*` auth configuration is baked in at build time;
verify its CI variables against `infra/cognito` outputs.

Review actual plans and apply only required changes, respecting dependency order.
For initial provisioning, secret containers and Cognito ID publication must be
ready before launching the API. The routing/image dependency sequence is:

```text
atlantis apply -d infra/iam
atlantis apply -d infra/ecr
atlantis apply -d infra/alb-internal
atlantis apply -d infra/cloudfront
atlantis apply -d infra/route53-private-zone
atlantis apply -d infra/dashboard-ecs
```

Each apply needs its reviewed plan; apply new producer outputs before replanning
consumers. Current `atlantis.yaml` enables autoplan and requires `mergeable` for
apply; a past webhook failure does not establish today's webhook or branch status.

Backend/frontend CI publishes images after matching main changes but does not roll
services. Confirm publication and inspect the selected digest before cutover.
Metadata-only changes need an explicit backend image build because current workflow
path filters omit `projects/` and `accounts.yaml`.

## Explicit rollout

Record reviewed `family:revision` values or full task-definition ARNs in
`API_TASK_DEFINITION`, `WORKER_TASK_DEFINITION` and `FRONTEND_TASK_DEFINITION`.
Inspect each with `aws ecs describe-task-definition` for ARM64, image selection,
auth environment and secret references. Do not select a bare family/latest revision
or rely on `--force-new-deployment` to choose one. `main-latest` can move even when
the task-definition revision is fixed; record the image digest actually deployed.

```bash
: "${API_TASK_DEFINITION:?Set the reviewed API revision}"
: "${WORKER_TASK_DEFINITION:?Set the reviewed worker revision}"
: "${FRONTEND_TASK_DEFINITION:?Set the reviewed frontend revision}"
aws ecs update-service --region ap-northeast-2 --cluster demo-platform-dev \
  --service demo-platform-api-dev --task-definition "$API_TASK_DEFINITION" \
  --force-new-deployment
aws ecs update-service --region ap-northeast-2 --cluster demo-platform-dev \
  --service demo-platform-worker-dev --task-definition "$WORKER_TASK_DEFINITION" \
  --force-new-deployment
aws ecs update-service --region ap-northeast-2 --cluster demo-platform-dev \
  --service demo-platform-frontend-dev --task-definition "$FRONTEND_TASK_DEFINITION" \
  --force-new-deployment
aws ecs wait services-stable --region ap-northeast-2 --cluster demo-platform-dev \
  --services demo-platform-api-dev demo-platform-worker-dev demo-platform-frontend-dev
aws ecs describe-services --region ap-northeast-2 --cluster demo-platform-dev \
  --services demo-platform-api-dev demo-platform-worker-dev demo-platform-frontend-dev \
  --query 'services[].{service:serviceName,taskDef:taskDefinition,desired:desiredCount,running:runningCount,deployments:deployments}'
```

These commands preserve desired counts. When enabling the worker, explicitly
select its reviewed revision and intended count; a successful wait at count zero
is not evidence of a working consumer. Inspect running tasks with
`aws ecs list-tasks` / `aws ecs describe-tasks`, including image digests and health.

## Public and authenticated checks

From a public-network vantage point, verify DNS and TLS for both aliases. The
private hosted zone resolves these names to the internal ALB, so checks from that
VPC alone do not exercise CloudFront. Route 53 alias A answers need not show a
`*.cloudfront.net` CNAME.

```bash
curl -fsS https://admin-api-dev.atomai.click/health
curl -sS -o /dev/null -w '%{http_code}\n' https://admin-api-dev.atomai.click/api/projects
curl -sS -o /dev/null -w '%{http_code}\n' https://admin-dev.atomai.click/
curl -sS -o /dev/null -w '%{http_code}\n' https://admin-dev.atomai.click/api/projects
```

Expect health/root 200 and both anonymous project requests 401. Confirm in a
browser that Cognito login, access-token authorization and real project data work.
For first setup, create the agreed admin with `aws cognito-idp admin-create-user`
using the current pool ID, and set its password through a protected operator flow;
do not put passwords in shell arguments or logs. The API allowlist must also match.

Before an authorized lifecycle smoke test, inspect current project metadata and
`always_on` flags. The checked-in mall RDS resource is always-on; do not follow the
old instruction to test an RDS stop. Verify a selected controllable resource's job
and restoration data before expanding the test.

For rollback, use a known-good ARM64 task definition and retained compatible image,
then explicitly update the service and repeat checks. See the
[architecture rollback procedure](arm64-graviton-migration.md). Investigate logs
under `/demo-platform/dev/{api,worker,frontend}` when health or auth fails.
