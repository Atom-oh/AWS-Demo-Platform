# Dashboard ECS runtime

This module defines the dev Fargate cluster `demo-platform-dev` and three ARM64
services: API, worker and frontend. It does not describe their current running
revisions or guarantee endpoint health.

| Service | Definition and ingress |
| --- | --- |
| `demo-platform-api-dev` | Initial count 1, port 8080, API target group and `admin-api-dev` route |
| `demo-platform-worker-dev` | Initial count 0, asynchronous SQS consumer, no public listener |
| `demo-platform-frontend-dev` | Initial count 1, port 3000, frontend target group and `admin-dev` route |

Verify resource names in `main.tf` before operations. State key:
`production/aws-demo-platform/dashboard-ecs/terraform.tfstate`. Dependencies are
the shared network, internal ALB, IAM, queues/tables, secret containers and populated
Cognito IDs. The API production entry wires real DDB/SQS dependencies and enforces
Cognito/administrator checks; `/health` alone is not an end-to-end application test.

## Images and rollout

Backend CI builds API and worker images; frontend CI builds the Next.js image.
All use native `linux/arm64` builds and matching task architecture. CI pushes
`sha-<sha>` and floating image tags, but does not update ECS services.

Services declare `ignore_changes = [task_definition, desired_count]`. Terraform can
register a task definition without moving a service to it. Select an explicit
reviewed task-definition revision for `aws ecs update-service`, then verify tasks,
counts, image architecture, target health and public application behavior. Do not
infer a rollout from a main merge or image push.

## Worker and configuration prerequisites

The worker's zero count is an initialization default. Current counts are operated
out-of-band and must be read from ECS. Backend CI already copies `projects/` and
`accounts.yaml` into `_config`; the worker Dockerfile copies both into its image,
and the API Dockerfile copies project configuration. Config packaging is implemented.

Before enabling or updating the worker, verify the built image contains the intended
configuration, the GitHub/ArgoCD secret values are populated, and role/ExternalId
access is correct. Project/account-only changes do not match current backend CI
path filters, so arrange an image build and explicit rollout. Do not label the
worker permanently scaffolded or assume a zero Terraform default means it is off.
