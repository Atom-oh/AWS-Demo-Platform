# Design Spec: Public Cognito-Protected Dashboard with Real Toggles

**Date:** 2026-06-03
**Goal:** Deploy the Stage 3 Next.js dashboard to a public URL **`admin-dev.atomai.click`**, protected by **Cognito login**, with **real working on/off toggles** end-to-end.
**Source of analysis:** parallel deep-analysis workflow `wf_950ff459-489` (5 phase analysts + risk critic), all claims re-verified against the live tree.

---

## Locked decisions (from the risk critic, verified)

1. **Architecture = `amd64` / `X86_64`.** PR #16 (arm64/Graviton) is a *phantom merge*: `gh` reports it merged but its commits (`b18c0f3`, `8853ff5`) are **not ancestors of `main`** (verified `git merge-base --is-ancestor` → not on main; `backend-ci.yml:87` still `--platform=linux/amd64`; `dashboard-ecs/main.tf:55,118` still `X86_64`). The frontend image and its Fargate task **must be amd64** to match the live baseline. Reconciling PR #16 is a separate human decision.
2. **Same-origin CloudFront.** One distribution for `admin-dev.atomai.click`: `default` behavior → frontend TG; ordered `/api/*` behavior → an origin whose `domain_name = admin-api-dev.atomai.click` (so it hits the **existing** ALB priority-120 api rule). `/api/*` uses **CachingDisabled + AllViewer** so the `Authorization` header reaches the api. **No `API_ORIGIN`** on the frontend task; no CORS.
3. **Access token, not id token.** `jwt-cognito.ts` `createCognitoVerifier` uses `tokenUse:'access'` and matches `cognito:username` against `ADMIN_USERNAMES` (default `atomoh`). The SPA sends the Cognito **access token** as `Authorization: Bearer`.
4. **Partial `turn_on` → `markError`.** `markOn` does `REMOVE restoration_data` (verified `state.ts:118`); on a partial turn_on failure we call `markError` (unconditional, preserves `restoration_data`) so a retry can re-restore.
5. **Unique restoration key.** `stepKey(res)=res.type` (verified `job-runner.ts:100`) collides for the **2× `argocd-app`** in `multi-region-mall`. Make the key unique per resource for **both** the turn_off write and the turn_on read.
6. **OIDC role is repo/branch-scoped, not workflow-pinned** (`infra/iam/gha-ecr-push-role.tf:25` → `repo:Atom-oh/AWS-Demo-Platform:ref:refs/heads/main`), so `frontend-ci.yml` can push with **no IAM change**.

---

## Phases (recommended order)

### PRE-0 / PRE-1 — human, blocking
- Reconcile PR #16 (decide amd64-now — recommended — or cleanly re-merge arm64 to main first).
- `atlantis apply -d infra/cognito` if not applied; verify `/demo-platform/dev/cognito/{user-pool-id,app-client-id}` hold non-empty values; create the Cognito user `atomoh` with a permanent password (pool is `allow_admin_create_user_only`).

### Phase B — worker real `turn_on` restoration  *(this PR)*
- `job-runner.ts`: (1) unique `stepKey` per resource; (2) on `turn_on`, read the off-state record's `restoration_data` and dispatch per-type into the existing controller `turnOn(rd)` methods; (3) RDS `waitForAvailable` fire-and-forget (don't hold the SQS message); (4) partial `turn_on` → `markError` (preserve restoration_data); full success → `markOn`.
- Controllers already implement `turnOn(rd)` + unit-tested — Phase B only wires them in.
- Tests: idempotent-skip (empty restoration), multi-resource dispatch (incl. 2× argocd-app via unique keys), partial-failure → markError, RDS fire-and-forget.

### Phase A — api serves real data  *(this PR)*
- `api/src/server.ts` prod entry: construct `DynamoDBDocumentClient` → `StateClient`/`JobsClient`, `SQSClient`, `loadProjects`/`loadAccounts`, and (when `!skipJwt`) `createCognitoVerifier`; inject all into `buildServer`.
- `api/Dockerfile`: bake `_config/projects` + `_config/accounts.yaml` (CI already bundles them; same build context as worker).
- `infra/dashboard-ecs/main.tf`: api task env (`DDB_TABLE_*`, `SQS_QUEUE_URL`, `PROJECTS_DIR`, `ACCOUNTS_FILE`, `ADMIN_USERNAMES`) + `secrets` (`COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`); `data.tf`: two `aws_secretsmanager_secret` data sources.

### Phase C — frontend image  *(next PR)*
- `frontend/next.config.mjs` → `output:'standalone'`; `frontend/Dockerfile` (node:20-alpine standalone, `PORT=3000`, `HOSTNAME=0.0.0.0`); `.dockerignore`; `infra/ecr` add `demo-platform/frontend`; `.github/workflows/frontend-ci.yml` (amd64, OIDC push on merge to main).

### Phase D — frontend infra  *(next PR)*
- `infra/alb-internal` frontend TG (`demo-platform-fe-dev`, port 3000, health `/` 200) + listener rule priority 130 host `admin-dev.atomai.click`.
- `infra/cloudfront` same-origin distribution (two origins/behaviors per decision #2).
- `infra/route53-private-zone` public alias `admin-dev.atomai.click` → CloudFront (private split-horizon record already exists).
- `infra/dashboard-ecs` frontend task def + service (port 3000) + SG ingress 3000.

### Phase E — Cognito login  *(next PR)*
- Authorization Code + **PKCE** (public SPA client) Hosted-UI flow: `lib/auth-config.ts`, `lib/pkce.ts`, `lib/auth.ts`, `lib/token-store.ts` (access/id in memory, refresh in sessionStorage), `components/AuthProvider.tsx`, `components/LoginGate.tsx`, `app/auth/callback/page.tsx`; `lib/api.ts` attaches `Bearer <access_token>`; `app/page.tsx` gated + logout; `NEXT_PUBLIC_AUTH_ENABLED=false` dev bypass (mirrors api `skipJwt`).
- `NEXT_PUBLIC_*` are **build-time inlined** → the prod image must be built with prod Cognito values + `redirect_uri=https://admin-dev.atomai.click/auth/callback`.

---

## Cross-phase deployment guardrails (human actions)

- **Image-before-infra:** merge code → confirm new image digest in ECR → apply/roll infra. ECS services use `ignore_changes=[task_definition]` so `atlantis apply` registers a revision but does **not** roll the service — force `aws ecs update-service --force-new-deployment` after the new image + revision exist.
- **ECR repo before first push:** `atlantis apply -d infra/ecr` before the first merge that triggers `frontend-ci`.
- **Worker must run for real toggles:** worker `desiredCount=0` today; scale to 1 after its config is baked + github/argocd secrets populated.
- **Apply order (Phase D):** `alb-internal` → `cloudfront` → `route53-private-zone` → `dashboard-ecs`.
- **Safe-first live toggle order (real data):** only `argocd-app` (×2, `multi-region-mall`) and `rds` exist — **no ecs/ec2**. Test a single `argocd-app` first; `rds` last (slow start, fire-and-forget).
- **CloudFront `/api/*` must use CachingDisabled + AllViewer** or the `Authorization` header is stripped → 401.
