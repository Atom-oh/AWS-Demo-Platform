# AWS Demo Platform — original design

**Date:** 2026-05-26. **Original status:** draft, pending implementation.
**Reconciled:** 2026-09-13. Historical rationale; examples and execution transcripts
remain in Git history. Use [current architecture](../../architecture.md) and the
[root guide](../../../CLAUDE.md) for implemented boundaries.

## Intent and scope

Provide one administrator with a catalog of GitHub-linked AWS demos, resource
on/off controls and restoration, URLs, and eventually secret management. Reduce
idle demo compute costs while accepting brief outages and small deployments.
The initial target was three to five independent AWS accounts using configured
operator roles and ExternalIds, with a Korean management hub and tenant spokes.
It was not a production HA/DR, compliance, cost-analysis or multi-user platform.

The four stages were infrastructure ownership migration, lifecycle backend,
dashboard, then optional operational features. This roadmap was broader than the
implemented MVP; stage labels and unchecked completion lists were not deployment
records. [The Stage 1 retrospective](../retrospectives/2026-05-26-stage-1.md)
records what its author observed at the time.

## Decisions and trade-offs

| Area | Original choice and reason |
| --- | --- |
| Ownership | Reuse `mall-apne2-mgmt`; move hub definitions into this repository while tenant workloads stay in their owning repositories |
| GitOps | Separate system and tenant App-of-Apps roots; initially manage the Korean spokes, not the tenant's US clusters |
| Runtime | Next.js and Node/TypeScript on ECS Fargate, separate from the EKS automation hub |
| Metadata/state | Git YAML for accounts/projects; DynamoDB for lifecycle state, jobs and history |
| Credentials | Separate runtime Operator and infrastructure Terraformer roles with ExternalIds to limit shared blast radius |
| Public ingress | CloudFront VPC Origin → internal ALB → target IPs; ALB HTTPS accepts the CloudFront source SG and `10.0.0.0/8` |
| DNS | Public aliases resolve to CloudFront; private aliases resolve to the internal ALB |
| Infrastructure workflow | GitHub App-backed Atlantis handles reviewed Terraform changes, sharing the existing backend with unique state keys |
| User experience | Master/detail discovery, single-admin Cognito login and asynchronous action polling |
| Demo off | Stop supported compute while retaining restoration data; HPA-managed workloads accept the cost of one replica |

The migration retained the hub's existing state key,
`production/ap-northeast-2/eks-mgmt/terraform.tfstate`, in
`multi-region-mall-terraform-state`. Shared VPC/data infrastructure remained in
`multi-region-architecture`, creating a deliberate remote-state dependency.
The destructive ArgoCD cutover allowed downtime; it was an initial migration
choice, not standing permission to remove live resources. Current cutovers follow
the [review/release runbook](../../runbooks/review-and-release.md).

## How implementation diverged

- The backend became separate API and worker services with SQS, rather than one
  backend process. [ADR-001](../../decisions/ADR-001-sqs-worker-for-async-jobs.md)
  documents nontransactional admission, replay and partial restoration limits.
- [ADR-002](../../decisions/ADR-002-argocd-control-via-rest-api.md) chose ArgoCD REST,
  not direct Kubernetes calls. Off pins HPA bounds **and all matched workload
  replicas to one**. RDS supports lifecycle control unless marked `always_on`;
  other visibility-only types have no controller.
- [ADR-005](../../decisions/ADR-005-cognito-spa-auth-code-pkce.md) chose public-client
  PKCE with memory/sessionStorage, not Amplify plus an httpOnly-cookie BFF. The
  access-token claim is `username`; `cognito:username` is the plugin adapter's
  internal field. The client has no secret.
- API/worker/frontend repositories publish mutable `sha-*` and `main-latest`
  image tags through OIDC and native ARM64 builds. CI does not roll ECS or provide
  the proposed automatic semver-to-production/release-please pipeline. See
  [ADR-003](../../decisions/ADR-003-gha-oidc-ecr-push.md) and
  [ADR-006](../../decisions/ADR-006-arm64-graviton-native-build.md).
- Worker GitHub discovery stores a snapshot; the UI catalog comes from configured
  YAML. Automatic registration PRs, secrets UI, scheduled toggles, dynamic
  `ec2-tag` URLs and live demo health checks remain unimplemented.
- The proposed Tempo removal/ClickHouse-only observability path was not the final
  topology. Tempo remains alongside ClickHouse; private observability fan-in has
  the scoped [ADR-007](../../decisions/ADR-007-mgmt-observability-internal-nlb-exception.md)
  exception. Grafana ownership and credentials now follow
  [ADR-018](../../decisions/ADR-018-grafana-private-origin.md).

The original risks remain useful review questions: shared-state ownership,
producer-before-consumer ordering, ExternalId handling, ArgoCD bootstrap,
credential expiry and partial resource mutations. Old IAM snippets, task counts,
prices, resource IDs and expected test output are not current configuration or
runtime evidence. [Onboarding](../../onboarding.md),
[account onboarding](../../onboarding/friend-account-setup.md) and
[dashboard context](../../../dashboard/CLAUDE.md) own current procedures.
