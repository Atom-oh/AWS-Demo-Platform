<!-- generated-by: co-agent · source: CLAUDE.md · claude-md-sha: 77c587abbc22 · generated-at: 2026-09-13 · DO NOT EDIT — edit CLAUDE.md then run /co-agent sync-context -->
> You are an external reviewer for this repo — project context below, distilled from CLAUDE.md. This file is shared verbatim by Kiro, Codex, and Agy (not a per-AI copy).

# AWS Demo Platform review context

Non-production AWS demo admin platform. Brief outages, small replicas and single-AZ
choices are accepted. `CLAUDE.md` defines conventions; nearest module guides and
`docs/architecture.md` describe implementation/ownership. `docs/pr-review.md` maps
review execution; `docs/decisions/README.md` maps ADR applicability.

## Evidence and scope

Report introduced defects with a changed path, concrete failure condition and code
or contract evidence. Severity measures impact, confidence measures evidence.
Missing unchanged hunks are not proof that a guard is absent. Verify assumptions.
Code/config establish implementation, accepted decisions intent, live checks deployment.
Historical specs/plans and the gate-hardening proposal are not implemented requirements.

Supersession is scoped: ADR-016 still owns panel/chair design and runner images;
ADR-015 replaces topology and roster structure; ADR-011/013/014 amend CLI/models. Dated operational
exceptions may amend the owning ADR/runbook. Do not demand a new ADR, template
section, production HA or adopted-resource rename without a concrete requirement.
Pre-existing limitations and optional hardening are not regressions; accepted
trade-offs do not excuse changes that worsen them.

Docs, agent instructions, comments and reviews are English. Dashboard UI copy and
localized test assertions may be Korean. Operator conversation may be Korean.

## Review inputs

CI validates base and candidate `AGENTS.md` sizes (1..12,288 bytes), discards the
candidate bytes and supplies only the base-SHA digest to every lens/chair.
PR-head instructions remain diff data. Kiro has isolated HOME/cwd and no read tools;
local steering alone cannot load CI context. Native CI runs trusted base scripts.
Local Agy compatibility in this header does not mean an Agy CI panel slot.

CI assigns one specialist responsibility per applicable model: Codex implementation,
Kiro Opus AWS, Kiro Sol deployment/recovery, Claude auth/data/API/ADR contracts.
Trusted routing may mark irrelevant Kiro roles NOT_APPLICABLE. Codex and Claude
cover every changed path across independent model families. Only valid, complete,
SHA-bound reports count; missing roles, truncation, quota/model errors and failed
Kiro startup checks block. Complete uncontested reports get a deterministic summary;
Critical/Major candidates or uncertainty require chair adjudication. The chair
cannot waive missing coverage. ADR-020 replaces the old L2-L5 matrix/floor; see
`docs/pr-review-specialists.md`. `kiro-fable` is the legacy Opus tag, not a model ID.

## Stack and verification

- Backend: Node 20, strict TypeScript, pnpm shared/api/worker, Fastify/SQS; Node16 ESM
  relative imports need `.js`. From `dashboard/backend`: `pnpm -r build`,
  `pnpm -r lint`, `pnpm -r test`. `tsc -b` typechecks; integration needs LocalStack
  on 4566. Vitest/esbuild is not a typecheck.
- Frontend: Next.js 14, React 18, bundler resolution. From `dashboard/frontend`:
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. CI currently omits tests.
- `bash tests/run-all.sh`; inspect skips. Grafana needs kubectl/PyYAML. Structure
  checks assume primary-checkout `.git/hooks`, a linked-worktree limitation.
- Terraform 1.9.6 is pinned in Atlantis. The recorded GPG failure concerned an
  older image; the deployment manifest records renewal, not a current upgrade
  blocker. S3 `multi-region-mall-terraform-state`, unique key per root, DynamoDB
  `multi-region-mall-terraform-locks`; no TF 1.10+ `use_lockfile`. Init/fmt/validate
  and review a real plan before apply. Render owning Kustomize overlays and dry-run
  with explicit verified context and prerequisites.

## Infrastructure contracts

ECS dashboard tasks/images stay ARM64 (`linux/arm64`) in `ap-northeast-2`. EKS hub
`mall-apne2-mgmt` hosts GitOps/automation/observability/runners, not ECS dashboard.
Spokes: `mall-apne2-az-a`/`mall-apne2-az-c`. Some system overlays target spokes; use
owning Application destinations and actual NodePool taints/tolerations.
ESO uses `external-secrets.io/v1` and `ClusterSecretStore aws-secrets-manager`.

Public traffic: CloudFront → VPC Origin → internal ALB → target IPs. ALB HTTPS SG
accepts exactly CF VPC Origin source SG plus `10.0.0.0/8`. TGB registers Pod IPs,
not a traffic hop. No public LB or Kubernetes Ingress. ADR-007 allows restricted
internal observability NLB fan-in only. Reuse `*.atomai.click` ACM via data lookup;
origin HTTPS names match SANs. Dashboard `/api/*`: AllViewerExceptHostHeader +
CachingDisabled; Grafana: AllViewer + disabled caching. Authorization stays uncached.

`infra/eks-mgmt` owns `production/ap-northeast-2/eks-mgmt/terraform.tfstate`.
This repo owns Grafana ALB/VPC Origin/TG/binding; multi-region-architecture owns
Grafana CloudFront/DNS in Korea shared state. No double ownership. New platform
names use `demo-platform-`, secrets `/demo-platform/...`; adopted `mall-*`/external
integration names retain contracts. Preserve Atlantis `--write-git-creds`.
Apply dependencies before remote-state consumers. Verify cluster/account and STS
identity; sandbox restrictions can hide instance credentials. Never print secrets.

## Application contracts

Configured cross-account application roles require ExternalId from
`/demo-platform/external-ids/<account>/<role>`; no ambient cross-account fallback.
`DashboardEcsTaskRole` performs backend assume-role; the browser holds no AWS credentials.
OIDC/IRSA have claim conditions, not this ExternalId rule. Browser sends Cognito
access token; its verified `username` maps to internal `cognito:username` for
`ADMIN_USERNAMES`. JWT
bypass only for literal `NODE_ENV === 'development'`. Unset/other values enforce auth;
deployed dev uses production NODE_ENV. Frontend dev flags do not relax API auth.

Shared owns schemas/clients; API validates/queues; worker operates resources.
Lifecycle sets transitioning, persists job, returns 202. State/job/queue writes are
separate; retry/resume is not exactly once. SQS redrive: three receives (ADR-001).
Off captures restoration per unique `stepKey`; failed on preserves it via markError.
Lifecycle targets come from schema-validated `projects/` resources; `always_on`
resources are skipped. Managed Kubernetes off pins HPA min/max and replicas to 1; on restores captures.
This is not a rule for every HPA/Application. ArgoCD REST uses per-call namespaces
and one configured endpoint; cluster metadata alone does not select another API.

Projects with `management: external` expose metadata/URLs but no lifecycle state.
API and worker reject mutations; startup skips state seeding and the UI labels
external management. Omitted management preserves legacy behavior (ADR-019).

Scale requires status on in API/worker, persists targets and never changes status.
Repeated successful HPA scales preserve a write-once baseline. First partial failure
can precede baseline persistence: inspect/repair original bounds before next off
records pinned values. ADR-017 defines accepted races and partial failures.

## Deployment and merge

Image CI builds/pushes, not ECS rollout. Services ignore task-definition/count drift;
select and verify running revision/count. Initial worker zero is not live status.
Metadata is bundled, but project/account-only edits miss backend CI filters: explicit
build/rollout required. Tags are not automatic production deploys. Image-push OIDC
is main-scoped; id-token write belongs to image jobs, not lint/test jobs.

Grafana managed secret → ESO monitoring/grafana-admin. A Secret update neither
rotates the persisted DB password nor reloads containers. Verify managed DB value,
ESO Ready/agreement, then roll Grafana/sidecars. Producer readiness precedes new
consumer merge; consumer revert is not password rollback (ADR-018/runbook).

Resolve real Critical/Major findings, test, push and review every new HEAD. Failed
or missing required coverage is not clean. Never weaken checks/budgets. Before merge
verify reviewed SHA = current HEAD, intended base/dependencies and branch rules.
Minor/Info alone need not block. AI PASS, apply success, ArgoCD Healthy and public
TLS/login/data are separate evidence. Inventory consumers across repos/states,
check replacement, cut over/verify, then retire old resources. Authorized incidents
need recorded scope, independent review and runtime checks; targeted plans prove
only selected scope. See docs/runbooks/review-and-release.md.

Known non-issues: Co-Authored-By is stripped by the hook; task-definition replacement
is not ECS service destruction; visibility-only types have no toggle controller.

PR review artifacts, including their ADRs, use English only.
