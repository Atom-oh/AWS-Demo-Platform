# Runbook: execute the public dashboard deploy (admin-dev.atomai.click)

**ARM64 / Graviton throughout** (PR #16 landed on main mid-deploy). Region
`ap-northeast-2`, cluster `demo-platform-dev`. Pre-verified: Cognito secrets
populated (pool `ap-northeast-2_xmcmwdt3y`, client `15nrbre7cihib0urg46r025ajp`),
worker github/argocd secrets set, `COGNITO_APP_CLIENT_ID` repo variable set,
Atlantis up (comment-triggered plan works; PR-open autoplan does NOT — trigger
plans by commenting). Live-infra applies/merges/redeploys are yours to run (the
harness gates autonomous shared-infra apply).

## Current state (2026-06-04)
- **#18 (backend A+B) is MERGED.** arm64 api/worker images built & pushed to `:main-latest`.
- The api **task-def rev:2 that was applied is stale `X86_64`** — DO NOT redeploy the api
  to rev:1/rev:2; with `:main-latest` now arm64 it would exec-format-crash. The running
  api (rev:1 + cached old image) is still up; leave it until an ARM64 rev exists.
- **#19 (frontend C+D+E)** now contains the **full ARM64 `dashboard-ecs`** (api+worker+frontend)
  after merging main. Applying `dashboard-ecs` from #19 registers the correct ARM64
  api/worker/frontend task-defs in one shot (fixes the api arch + adds the frontend).

## Deploy — all via the open, green #19 (Atlantis `apply_requirements: [mergeable]`)

1. Confirm #19 is green (review + lint-build). Then comment these on #19 **in order**
   (wait for each "Applied"):
   ```
   atlantis apply -d infra/ecr                  # frontend ECR repo (before merge!)
   atlantis apply -d infra/alb-internal         # frontend TG + listener rule 130
   atlantis apply -d infra/cloudfront           # admin-dev distribution (~10–15 min)
   atlantis apply -d infra/route53-private-zone # public alias -> CloudFront
   atlantis apply -d infra/dashboard-ecs        # ARM64 api+worker+frontend task-defs
   ```
   `dashboard-ecs` apply registers a new **ARM64** api revision (rev:3+) with the Cognito
   secrets, a worker ARM64 rev, and the frontend ARM64 task-def. The frontend service is
   created but tasks stay PENDING until its image exists (next step) — expected.

2. **Merge #19** → `frontend-ci` `push-image` builds the **arm64** frontend image → ECR.

3. **Roll the services** (find the new ARM64 api rev first):
   ```
   AREV=$(aws ecs describe-task-definition --task-definition demo-platform-api-dev \
     --query 'taskDefinition.revision' --output text --region ap-northeast-2)
   # sanity: must be ARM64
   aws ecs describe-task-definition --task-definition demo-platform-api-dev:$AREV \
     --query 'taskDefinition.runtimePlatform.cpuArchitecture' --output text --region ap-northeast-2   # ARM64

   aws ecs update-service --cluster demo-platform-dev --service demo-platform-api-dev \
     --task-definition demo-platform-api-dev:$AREV --force-new-deployment --region ap-northeast-2
   aws ecs update-service --cluster demo-platform-dev --service demo-platform-frontend-dev \
     --force-new-deployment --region ap-northeast-2
   aws ecs update-service --cluster demo-platform-dev --service demo-platform-worker-dev \
     --desired-count 1 --force-new-deployment --region ap-northeast-2
   ```

4. **Verify the api (fail-closed)** after ~2–3 min:
   - `curl -s -o /dev/null -w '%{http_code}\n' https://admin-api-dev.atomai.click/health` → **200**
   - `curl -s -o /dev/null -w '%{http_code}\n' https://admin-api-dev.atomai.click/api/projects` → **401**
   - If `/health` ≠ 200: check CloudWatch `/demo-platform/dev/api`; roll back with the previous ARM64 rev.

5. **Create the Cognito admin user** (to log in):
   ```
   aws cognito-idp admin-create-user --user-pool-id ap-northeast-2_xmcmwdt3y --username atomoh --message-action SUPPRESS
   aws cognito-idp admin-set-user-password --user-pool-id ap-northeast-2_xmcmwdt3y --username atomoh --password '<choose-strong>' --permanent
   ```

6. **Verify the public dashboard** (after CloudFront finishes deploying):
   - `dig +short admin-dev.atomai.click` → a `*.cloudfront.net` record
   - `curl -sI https://admin-dev.atomai.click/` → 200 (HTML)
   - `curl -s -o /dev/null -w '%{http_code}\n' https://admin-dev.atomai.click/api/projects` → **401**
     (proves `/api/*` reaches the **api**, not the frontend — the AllViewerExceptHostHeader fix)
   - Browser → `https://admin-dev.atomai.click` → Cognito login as `atomoh` → dashboard with real data.

## After it's up — safe-first live toggle test
Only `argocd-app` (×2, multi-region-mall) and `rds` exist (no ecs/ec2). Test a single
`argocd-app` first; `rds` last. Confirm `DemoPlatformOperator` has start perms in the target account.

## Notes / risks
- arm64 everywhere now (api/worker/frontend all ARM64; CI builds linux/arm64 on the
  `aws-demo-platform-arm` self-hosted runner). node:20.16-alpine is multi-arch.
- api is fail-closed (NODE_ENV=production ⇒ Cognito JWT required); secrets populated, step 4 confirms.
- Rollback any service: `update-service --task-definition <family>:<prev-arm64-rev> --force-new-deployment`.
- The previously-applied X86_64 api rev:2 is stale/harmless once a higher ARM64 rev is deployed.
