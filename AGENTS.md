<!-- generated-by: co-agent · source: CLAUDE.md · claude-md-sha: 96fa60adb6f4 · generated-at: 2026-06-08 · DO NOT EDIT — edit CLAUDE.md then run /co-agent sync-context -->
> You are Codex, an external reviewer — project context below.

# AWS Demo Platform — reviewer context

Admin platform to manage GitHub-linked AWS demo projects across accounts: discover repos, toggle demo resources (ECS/EC2/RDS/ArgoCD) on/off, surface demo & code-server URLs, manage Secrets Manager, operate cross-account via assume-role. **Non-production** — brief outages/disruption are explicitly acceptable; relaxed HA/multi-AZ/replicas is intentional (do **not** flag as a bug).

## Stack / runtime
- **IaC**: Terraform **1.9.8** (Atlantis bundles 1.9.6), AWS provider, shared S3 backend `multi-region-mall-terraform-state` (unique `key` per module). Do **NOT** use `use_lockfile` (TF 1.10+); locks via `dynamodb_table`.
- **Backend** (`dashboard/backend/`): Node 20, TypeScript, **pnpm workspaces monorepo** = `shared` / `api` (Fastify REST) / `worker` (SQS consumer). **Node16 ESM — every relative import needs a `.js` extension.**
- **Frontend** (`dashboard/frontend/`): Next.js 14 App Router, TypeScript (strict).
- **Compute**: ECS Fargate, **ARM64/Graviton** (images built `linux/arm64`). EKS hub `mall-apne2-mgmt` + spokes; ArgoCD (App-of-Apps); Atlantis (PR-driven TF); External Secrets Operator. **Scope: ap-northeast-2 only.**

## Commands (copy-paste)
```bash
# backend (from dashboard/backend)
pnpm install && pnpm -r build      # tsc -b is the REAL typecheck gate (vitest/esbuild skip type errors)
pnpm -r lint && pnpm -r test       # *.int.test.ts need LocalStack on :4566 (skip/fail locally without it)
# frontend (from dashboard/frontend)
pnpm install && pnpm typecheck && pnpm lint && pnpm build
# terraform (from infra/<module>)
terraform init -backend=false && terraform validate
# applied via Atlantis PR comments: atlantis plan -d infra/<module>  /  atlantis apply -d infra/<module>
# k8s manifests
kubectl kustomize k8s/system/<name> | kubectl apply --dry-run=client -f -
```

## Naming
- Terraform resources prefixed `demo-platform-`. Secrets Manager paths under `/demo-platform/...`.

## Security mandates / banned patterns (flag any violation)
- **CloudFront-only ingress**: every load-balancer SG accepts ONLY the CF VPC Origin source SG + `10.0.0.0/8`. **No public ALB/NLB. No Kubernetes Ingress.**
- **TargetGroupBinding (TGB)**: target groups created in Terraform; pods bound via TGB CRD (never an Ingress controller).
- **ACM**: always `data "aws_acm_certificate"` for the `*.atomai.click` wildcard. **Never issue a new cert.**
- **CloudFront origins**: `domain_name` must be a subdomain on the wildcard cert (SNI). For a same-origin distro routing `/api/*` to a different ALB host, the `/api/*` behavior must use **`AllViewerExceptHostHeader`** (so CF sends `Host`=origin domain) + **CachingDisabled** (forwards `Authorization`, never caches POST/auth).
- **HPA-2 on/off**: demo-off patches HPA `min=max=1` + Deployment `replicas=1` — **never `replicas=0` / true zero.**
- **Cross-account**: assume `OperatorRole` (read) / `DemoPlatformTerraformer` (write) / `DemoPlatformOperator` (worker toggles); **`ExternalId` is required** on the trust policy, sourced from Secrets Manager `/demo-platform/external-ids/<account>/<role>`.
- **Frontend never touches AWS**: no AWS SDK in `dashboard/frontend`; all cross-account ops go through the backend (`DashboardEcsTaskRole` → STS AssumeRole `DemoPlatformOperator`); the frontend never sees AWS credentials.
- **API is fail-closed**: `NODE_ENV=production` enforces Cognito JWT; `skipJwt` only when `NODE_ENV==='development'`. The api verifies the **access** token (`tokenUse:'access'`) and checks `cognito:username` ∈ `ADMIN_USERNAMES`.
- **CI auth**: no long-lived AWS keys — GitHub OIDC role `demo-platform-gha-ecr-push`, trust scoped to `repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main`, `id-token: write` only on the push job.
- **Atlantis**: keep the `--write-git-creds` flag (GitHub App auth) — don't strip it.

## Architectural boundaries
- **Backend layering**: `shared` (zod schemas, DDB clients state/jobs/history, ArgoCD & GitHub REST clients, AWS client factory, AssumeRole cache) ⟵ `api` (Fastify routes only; thin — no business logic) + `worker` (SQS consumer + 4 resource controllers ECS/EC2/RDS/ArgoCD).
- **Async model (ADR-001)**: api validates state → `transition→transitioning` → create DDB job → enqueue SQS → return `202 {job_id}`. Worker long-polls, processes idempotently, startup-sweep re-enqueues `running` jobs, DLQ after 3. `turn_off` captures `restoration_data`; `turn_on` restores per-resource; partial `turn_on` failure → `markError` (preserves restoration_data; api accepts turn_on from `off` OR `error`). Restoration keyed by a **unique per-resource `stepKey`** (same-type resources must not collide).
- **ArgoCD (ADR-002)**: control via ArgoCD **REST API** (Bearer admin token), not the k8s API.
- **ECS services** declare `lifecycle { ignore_changes = [task_definition, desired_count] }` — `terraform apply` registers a new task-def revision but does NOT roll the service; rollout is a manual `aws ecs update-service --task-definition <fam>:<rev> --force-new-deployment` (pin the rev; a bare force-deploy keeps the old rev).
- **Terraform**: one module per dir, each with its own `CLAUDE.md` + unique state key; cross-module refs via `terraform_remote_state` → **apply dependencies first** (a dependent module can't even `plan` until the dependency's output exists).

## Review checklist
- TF: no new ACM cert; no public LB; LB SG limited to CF VPC origin + RFC1918; `ExternalId` on cross-account trust; `demo-platform-` prefix; task `cpu_architecture` = `ARM64` and matches the image platform.
- Backend: `.js` import extensions; `tsc -b` clean; shared errors used for error handling; no AWS SDK leaking into the frontend; fail-closed JWT preserved.
- Cross-module TF ordering respected (don't expect a dependent plan to pass before its remote_state dependency is applied).
- Frontend: access token (not id token) sent as Bearer; same-origin `/api/*`.

## Known false-positives — do NOT flag these
- The repo **commit-msg hook strips `Co-Authored-By`** — its absence is expected, not a failure.
- `shared/**/*.int.test.ts` fail locally with `ECONNREFUSED :4566` (LocalStack) — they pass in CI's service container.
- A Terraform plan showing **task-definition "destroy and recreate"** is normal (task-defs are immutable); only an `aws_ecs_service` destroy would be alarming.
- Non-production: relaxed HA/single-AZ/`desiredCount=0`/brief downtime are deliberate, not defects.
- Several schema resource types (`dynamodb`/`lambda`/`stepfunctions`/`msk`/`firehose`/`elasticache`/`kafka`) are **visibility-only** (`always_on`) with no toggle path — by design.
