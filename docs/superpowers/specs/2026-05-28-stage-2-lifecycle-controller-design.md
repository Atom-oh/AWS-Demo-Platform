# Stage 2: Lifecycle Controller — Design Specification

**Date**: 2026-05-28
**Author**: atomoh (collaborative brainstorming)
**Status**: Approved (pending implementation)
**Parent spec**: `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`
**Stage 1 retrospective**: `docs/superpowers/retrospectives/2026-05-26-stage-1.md`
**Target env**: `dev` only (v0.X series, v1.0.0 시점에 prod 신규 생성)
**Target accounts**: `atomoh-main` 단독 (friend accounts는 Stage 4)

## Executive Summary

Stage 2 Lifecycle Controller는 데모 플랫폼의 백엔드 코어다. ECS Fargate에서 동작하는 두 개의 서비스(`api`와 `worker`)가 atomoh-main 계정의 ECS/EC2/RDS 서비스와 hub 클러스터의 ArgoCD Application을 cross-account assume-role로 토글한다. 상태는 DynamoDB 3개 테이블에 영구 추적되고, 비동기 작업은 SQS로 큐잉된다. 관리자 인증은 Cognito User Pool (atomoh 1명)이 담당한다.

Stage 3(Frontend)이 사용할 REST API 표면을 모두 갖춘다. Stage 4(친구 계정 onboarding, prod env, 알림, RBAC)는 명시적으로 범위 밖.

---

## 1. Scope

### 1.1 In Scope

**인프라 (Terraform via Atlantis):**
- DynamoDB 3 tables (`state-dev`, `jobs-dev`, `history-dev`), PAY_PER_REQUEST
- IAM: `DashboardEcsTaskRole-dev`, `DashboardEcsExecutionRole-dev`, `DemoPlatformOperator` (atomoh-main)
- ECS Fargate cluster + 2 services (`demo-platform-api-dev`, `demo-platform-worker-dev`)
- ECR repository `demo-platform/backend` (lifecycle policy)
- Internal ALB listener rule + Target Group for api service
- CloudFront distribution for `admin-api-dev.atomai.click` (VPC Origin → ALB)
- Route 53 (public + private hosted zones)
- Cognito User Pool `atomoh-demo-platform-dev` + App Client
- SQS queue `demo-platform-jobs-dev` + DLQ
- Secrets Manager paths (Cognito secrets, GitHub PAT, ExternalIds)

**백엔드 코드 (Node.js TS, `dashboard/backend/`):**
- `api` 서비스: Fastify REST API (`/api/projects`, `/api/projects/:repo`, `/api/projects/:repo/actions/{turn_on,turn_off}`, `/api/jobs/:id`, `/health`), Cognito JWT 검증, DDB state read, SQS enqueue
- `worker` 서비스: SQS consumer, 4 resource controllers (ECS, EC2, ArgoCD App + HPA-2, RDS), cross-account AssumeRole, DDB state/jobs/history write, GitHub repo discoverer (1h cron)
- `shared` 패키지: Zod schemas, AWS SDK v3 clients, DDB clients, logger (pino), error classes

**CI/CD:**
- `.github/workflows/backend-ci.yml`: PR에서 lint/typecheck/test, main 머지 시 ECR push + ECS `update-service --force-new-deployment` × 2

**테스트:**
- Vitest unit tests
- LocalStack 기반 integration tests (DDB, SQS, STS, Secrets Manager)
- ArgoCD는 in-test HTTP mock server로 검증

### 1.2 Out of Scope

- Frontend (Stage 3)
- prod env (v1.0.0)
- Friend account onboarding (Stage 4 — Stage 2는 atomoh-main 1개)
- Secret 추가/표시/rotate UI (Stage 3 backend + Stage 4)
- demo URL 헬스체크 (Stage 4)
- multi-user / RBAC (Stage 4)
- Slack/Discord 알림 (Stage 4)
- True 0-pod 지원 (HPA-3/4 — Stage 4)
- ECS dashboard 로그의 ClickHouse 통합 (Stage 4)

---

## 2. Decisions (Brainstorming 결과)

| # | 결정 | 근거 |
|---|---|---|
| D-1 | Stage 2를 단일 spec/plan으로 (decomposition 안 함) | 사용자 선택 — full coverage 우선 |
| D-2 | Cognito는 Stage 2부터 구축 | Stage 3 frontend 시작 시 인증 준비 완료 |
| D-3 | Job worker = SQS + 별도 worker ECS task | 견고함 > 단순함. SQS는 inframanagement 부담 적음 |
| D-4 | ArgoCD App 제어는 REST API (admin token) | k8s API 직접보다 일관·UI와 동일 행동. token rotate는 Stage 4 |
| D-5 | env scope = dev only | spec §6.9 일관, v1.0.0 시점에 prod |
| D-6 | RDS도 Stage 2에 포함 (spec §4.2 RDS 절 그대로) | "Full Stage 2" 결정에 의한 RDS controller도 빌드 |
| D-7 | GitHub discoverer는 worker 내장 (`setInterval`) | 별도 cron 인프라 없이 단순 |
| D-8 | Backend = TypeScript monorepo (pnpm workspaces: api/worker/shared) | 공유 코드 명확 분리 |
| D-9 | Web framework = Fastify (Express 아님) | TS 친화, 더 빠름 |
| D-10 | LocalStack을 dev 의존도 깊게 사용 | 실계정 비용 절감 + offline 개발 |

---

## 3. Architecture

### 3.1 End-state Flow

```
[GitHub] ── PR ──→ Atlantis (Terraform) / GitHub Actions (코드)
                     │
                     ▼
[ECR: demo-platform/backend:<sha>] ──→ ECS update-service
                     │
                     ▼
[ECS cluster: demo-platform-dev]
  ├─ demo-platform-api-dev      (Fargate, 1 task) ──┐
  └─ demo-platform-worker-dev   (Fargate, 1 task) ──┤
                                                    │ DashboardEcsTaskRole-dev
                  ┌─────────────────────────────────┘
                  │ sts:AssumeRole + ExternalId
                  ▼
        DemoPlatformOperator (in atomoh-main)
                  │
                  ├─ ECS UpdateService
                  ├─ EC2 Start/StopInstances
                  ├─ RDS Start/StopDBInstance
                  └─ SecretsManager List/CreateSecret

[SQS: demo-platform-jobs-dev] ←── api enqueue   worker dequeue ──→
                                       
[DDB] state-dev / jobs-dev / history-dev (TTL 7d/90d)

[ArgoCD REST API] hub cluster ←── worker (admin token from Secrets Manager)

[Cognito: atomoh-demo-platform-dev] ←── api (JWT verify via JWKS)

[User] → CF (admin-api-dev.atomai.click) → Internal ALB → api task
```

### 3.2 IAM Trust Chain

```
ECS task ─── ECS Task Role ───► DashboardEcsTaskRole-dev
                                    │
                                    │ sts:AssumeRole + ExternalId
                                    │   (from /demo-platform/external-ids/<account>/operator)
                                    ▼
                                  DemoPlatformOperator (in target account)
                                    │
                                    ▼
                                  AWS APIs (ECS/EC2/RDS/SecretsManager/DynamoDB describe)
```

#### DashboardEcsTaskRole-dev 권한

```
sts:AssumeRole on arn:aws:iam::*:role/DemoPlatformOperator
dynamodb:GetItem,PutItem,UpdateItem,Query,Scan on
  - arn:aws:dynamodb:ap-northeast-2:<atomoh-main>:table/demo-platform-state-dev
  - arn:aws:dynamodb:...:table/demo-platform-jobs-dev
  - arn:aws:dynamodb:...:table/demo-platform-jobs-dev/index/*
  - arn:aws:dynamodb:...:table/demo-platform-history-dev
sqs:SendMessage,ReceiveMessage,DeleteMessage,GetQueueAttributes on
  - arn:aws:sqs:...:demo-platform-jobs-dev
secretsmanager:GetSecretValue on
  - arn:aws:secretsmanager:...:secret:/demo-platform/dev/*
  - arn:aws:secretsmanager:...:secret:/demo-platform/external-ids/*
logs:CreateLogStream,PutLogEvents
eks:DescribeCluster (hub cluster auth — Stage 4 K8s direct를 위해 미리 부여)
```

#### DemoPlatformOperator (atomoh-main) Trust Policy

```json
{
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::<atomoh-main>:role/DashboardEcsTaskRole-dev"},
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {"sts:ExternalId": "${external_id}"}
    }
  }]
}
```

#### DemoPlatformOperator 권한 (좁게)

```
ecs:UpdateService,DescribeServices
ec2:StartInstances,StopInstances,DescribeInstances
rds:StartDBInstance,StopDBInstance,DescribeDBInstances
secretsmanager:ListSecrets,CreateSecret  (limit by ResourceTag/Name prefix)
dynamodb:DescribeTable,ListTables          (visibility only)
elasticache:Describe*,kafka:Describe*       (visibility)
```

### 3.3 Job Execution Model

```
[User] POST /api/projects/X/actions/turn_off
  │
  ▼
api:
  1. projects/X.yaml + accounts.yaml load (in-memory, cached + reloaded on signal)
  2. DDB state read → status must be `on` (else 409)
  3. DDB state write status=`transitioning`
     (ConditionExpression: previous status=`on`)
  4. DDB jobs insert: pk=job#<uuid>, status=`pending`, progress={}, created_at
  5. SQS SendMessage: {jobId, repo, operation: 'turn_off'}
  6. Response 202 {job_id}

[Worker] long-poll SQS (WaitTimeSeconds=20, MaxMessages=1, VisibilityTimeout=300s):
  1. DDB jobs read by jobId
  2. DDB jobs write status=`running`, started_at
  3. AssumeRole into target account (cached creds for ttl-30s)
  4. For each resource in project.resources (skip always_on):
       a. Controller turn_off (idempotent)
       b. DDB jobs progress patch
       c. DDB history append
  5. DDB state write status=`off`, restoration_data, last_action_at
  6. DDB jobs write status=`succeeded`|`partial_failure`|`failed`, completed_at
  7. SQS DeleteMessage

[Worker startup sweep]:
  - DDB jobs Query status=`running` AND started_at > now-1h
  - For each: re-process (idempotent)

[User polls] GET /api/jobs/:id → DDB read → 200 {status, progress, error?}
```

**RDS turn_on의 5+분 polling**: worker가 SQS DeleteMessage 즉시 실행하고 백그라운드 promise로 폴링 + DDB jobs progress 갱신. visibility timeout 회피.

### 3.4 Repository Layout

```
AWS-Demo-Platform/
├── accounts.yaml                     # Stage 1에서 작성
├── projects/                         # Stage 1에서 작성
│   ├── multi-region-mall.yaml
│   └── call-center-admin.yaml
├── infra/                            # Terraform (Atlantis)
│   ├── dynamodb/                     # NEW
│   ├── iam/                          # NEW (Stage 2)
│   ├── target-accounts/
│   │   └── atomoh-main/              # NEW: DemoPlatformOperator
│   ├── secrets-manager/              # NEW (slots only)
│   ├── sqs/                          # NEW
│   ├── cognito/                      # NEW
│   ├── ecr/                          # NEW
│   ├── dashboard-ecs/                # NEW
│   ├── alb-internal/                 # EXTEND (admin-api-dev TG + listener)
│   ├── cloudfront/                   # EXTEND (admin-api-dev distribution)
│   └── route53-{private-zone,public}/ # EXTEND
├── dashboard/
│   └── backend/                      # NEW (Node.js TS monorepo)
│       ├── package.json              # workspaces
│       ├── tsconfig.json
│       ├── pnpm-workspace.yaml
│       ├── docker-compose.yaml       # LocalStack for local dev
│       ├── packages/
│       │   ├── shared/
│       │   ├── api/
│       │   └── worker/
│       └── .dockerignore
└── .github/workflows/
    └── backend-ci.yml                # NEW
```

---

## 4. Component Designs

### 4.1 Infrastructure (Terraform)

#### 4.1.1 DynamoDB

3 tables, PAY_PER_REQUEST billing, `prevent_destroy=true`, deletion protection enabled.

| Table | PK | SK | GSI | TTL |
|---|---|---|---|---|
| `demo-platform-state-dev` | `pk: project#<repo>` | `sk: current` | — | — |
| `demo-platform-jobs-dev` | `pk: job#<uuid>` | — | `gsi1`: `gsi1pk: project#<repo>`, `gsi1sk: <iso>` | `ttl` 7d |
| `demo-platform-history-dev` | `pk: project#<repo>` | `sk: <iso8601>#<uuid>` | — | `ttl` 90d |

#### 4.1.2 ECS

- Cluster `demo-platform-dev` (Fargate-only)
- 2 services × 1 task each (api, worker)
- Task definitions: `cpu=512, memory=1024`. `lifecycle { ignore_changes = [container_definitions, task_definition] }` — GHA가 image 갱신
- api service: ALB Target Group attached (`/health` health check, port 8080)
- worker service: no LB
- Network: hub VPC private subnets (TGW 통해 cross-account 도달)
- Security group: outbound 443 + 80 (ECR pull, AWS APIs, GitHub) + inbound from ALB SG (api만)

#### 4.1.3 ALB / CF / R53

- 기존 `demo-platform-internal` ALB에 listener rule 추가: `host_header=admin-api-dev.atomai.click` → api TG
- 새 CF distribution: alias `admin-api-dev.atomai.click`, VPC Origin → ALB. WAF는 v0.X에서 생략
- 기존 PHZ `atomai.click` + public zone에 A records 추가 (split-horizon DNS)

#### 4.1.4 Cognito

- User Pool `atomoh-demo-platform-dev`:
  - sign-up disabled, MFA optional (TOTP), advanced security off (cost)
  - password policy: 12+ chars, upper/lower/digit/symbol
- App Client `dashboard-dev`:
  - public client (no secret) — Stage 3 SPA용
  - OAuth flows: `authorization_code`, scopes `openid, email, profile`
  - callback URLs: `https://admin-dev.atomai.click/auth/callback`, `http://localhost:3000/auth/callback`
  - logout URLs: same hosts root
- 1명 user(atomoh) 수동 등록 (Terraform `aws_cognito_user`)

#### 4.1.5 SQS

- Queue `demo-platform-jobs-dev`:
  - visibility timeout 300s
  - message retention 1d (재시도용)
  - DLQ `demo-platform-jobs-dlq-dev` (maxReceiveCount=3)

#### 4.1.6 ECR

- Repository `demo-platform/backend`:
  - tag mutability: IMMUTABLE for `<sha>`, MUTABLE for `main-latest`
  - lifecycle: untagged 7d 후 삭제, tagged 30개 유지

#### 4.1.7 Secrets Manager paths (empty slots, 수동 populate)

```
/demo-platform/external-ids/atomoh-main/operator    # Phase 2 수동 발급
/demo-platform/dev/cognito/app-client-id            # Phase 4 후 자동/수동
/demo-platform/dev/cognito/user-pool-id             # 동일
/demo-platform/dev/github/pat                       # Stage 1 GitHub PAT 재사용 가능?
/demo-platform/argocd/admin-token                   # Stage 1 retrospective Phase D에 password만 있음 → token 별도 발급
```

### 4.2 Backend Code Structure

```
dashboard/backend/
├── package.json                      # pnpm workspaces (no app code at root)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── vitest.config.ts                  # base
├── docker-compose.yaml               # localstack, gh API mock 옵션
├── .env.example
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── schemas/
│   │       │   ├── project.ts        # Zod: Project, ResourceRef variants (ecs, ec2, argocd, rds, always-on)
│   │       │   ├── account.ts        # Zod: Account, AccountRoleRef
│   │       │   └── ddb-records.ts    # Zod: StateRecord, JobRecord, HistoryRecord
│   │       ├── aws/
│   │       │   ├── client-factory.ts  # makeClient<T>(creds, region, ServiceCtor)
│   │       │   ├── assume-role.ts     # cross-account creds + cache + TTL
│   │       │   └── retry-config.ts
│   │       ├── ddb/
│   │       │   ├── state.ts          # readState, writeState (conditional)
│   │       │   ├── jobs.ts           # createJob, readJob, updateJobStatus, listRunning
│   │       │   └── history.ts        # appendHistory
│   │       ├── github/
│   │       │   └── client.ts         # octokit wrapper, repo list filter
│   │       ├── argocd/
│   │       │   └── client.ts         # REST helpers: get app, list workloads, scale, patch hpa
│   │       ├── logger.ts             # pino + correlation-id
│   │       ├── errors.ts             # Transient/Permanent/Conflict 분류
│   │       └── env.ts                # Zod-validated env
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts             # Fastify entry
│   │       ├── plugins/
│   │       │   ├── jwt-cognito.ts    # JWKS verify
│   │       │   └── projects-loader.ts # yaml load on startup + SIGHUP reload
│   │       ├── routes/
│   │       │   ├── health.ts         # /health (no auth)
│   │       │   ├── projects.ts       # GET /api/projects, GET /:repo
│   │       │   ├── actions.ts        # POST /api/projects/:repo/actions/{turn_on,turn_off}
│   │       │   └── jobs.ts           # GET /api/jobs/:id
│   │       └── middleware/
│   │           └── error-handler.ts
│   └── worker/
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/
│           ├── index.ts              # poll loop entry + startup sweep
│           ├── poll-loop.ts          # SQS long-poll
│           ├── job-runner.ts         # turn_off / turn_on dispatcher
│           ├── controllers/
│           │   ├── ecs.ts
│           │   ├── ec2.ts
│           │   ├── rds.ts            # RDS includes background poll
│           │   └── argocd.ts
│           ├── discoverer.ts         # 60min cron
│           └── progress.ts           # DDB jobs progress writer
```

#### Key TypeScript types

```ts
// shared/src/schemas/project.ts
export const EcsResource = z.object({
  type: z.literal('ecs'),
  cluster: z.string(),
  service: z.string(),
});

export const Ec2Resource = z.object({
  type: z.literal('ec2'),
  instance_ids: z.array(z.string()).min(1),
});

export const ArgocdResource = z.object({
  type: z.literal('argocd-app'),
  application: z.string(),
  cluster: z.string(),
  workload_selector: z.object({ namespace: z.string() }),
  hpa_handling: z.enum(['scale_to_one', 'ignore', 'delete']).default('scale_to_one'),
});

export const RdsResource = z.object({
  type: z.literal('rds'),
  db_identifier: z.string(),
  always_on: z.boolean().default(false),
});

// ... DynamoDB/ElastiCache/Kafka as always_on visibility-only
```

### 4.3 Resource Controllers

| Controller | turn_off | turn_on | restoration_data | Idempotency |
|---|---|---|---|---|
| `ecs.ts` | `DescribeServices` → if `desiredCount > 0`: store, `UpdateService desiredCount=0` | `UpdateService desiredCount=<stored>` | `{cluster, service, original_desired_count}` | `desiredCount == 0` skip |
| `ec2.ts` | `DescribeInstances` → if `running`: `StopInstances` | `StartInstances`, wait `running` | `{[{instance_id, previous_state}]}` | `state == stopped` skip |
| `rds.ts` | `DescribeDBInstances` → if `available`: `StopDBInstance` | `StartDBInstance` + background poll status (30s/1m/2m exponential, max 10min) | `{db_identifier, previous_status}` | `status == stopped` skip |
| `argocd.ts` | (1) ArgoCD `GET /api/v1/applications/:app/resource-tree` → 워크로드(Deploy/STS/HPA) 식별. (2) 각 리소스 `POST /api/v1/applications/:app/resource?namespace=&resourceName=&kind=&group=&version=` (manifest fetch). (3) replicas/min/max 추출. (4) 동일 endpoint patch 모드로 `replicas=1`, `minReplicas=1,maxReplicas=1` 적용 | reverse: 복원값으로 patch | `{application, workloads: {name: replicas}, hpas: {name: {min, max}}}` | target=current values skip |

ArgoCD는 `argocd-cm`의 `ignoreDifferences`가 Stage 1에서 적용됨 — Application은 OutOfSync 안 됨. ArgoCD REST API 통일은 admin token 단일 자격 + UI와 동일 행동 보장이 장점. K8s API 직접 대비 latency 약간 증가하지만 운영 복잡도 감소.

### 4.4 Cognito + JWT

- API `Authorization: Bearer <access_token>` 헤더
- JWKS endpoint: `https://cognito-idp.ap-northeast-2.amazonaws.com/<user-pool-id>/.well-known/jwks.json`
- 검증 라이브러리: `aws-jwt-verify` (Cognito 공식)
- 메모리 캐싱 (TTL 24h, JWKS 만료 시 refresh)
- 검증 후 `cognito:username` ∈ `ADMIN_USERNAMES` env (현재 `atomoh`)
- 위반 → 403 Forbidden
- `NODE_ENV=development`: JWT bypass, 가상 user `atomoh` 주입 (테스트에서만 활성)

### 4.5 GitHub Discovery

```ts
// worker/src/discoverer.ts
async function discover() {
  const octokit = new Octokit({ auth: githubPat });
  const repos = await octokit.paginate('GET /orgs/Atom-oh/repos', { per_page: 100 });
  const filtered = repos.filter(r => r.topics?.includes('demo-platform') || /* config flag */);
  await ddb.putItem({
    TableName: 'demo-platform-state-dev',
    Item: {
      pk: 'meta#discoverable',
      sk: 'current',
      repos: filtered.map(r => ({ name: r.full_name, default_branch: r.default_branch, topics: r.topics })),
      updated_at: new Date().toISOString(),
    },
  });
}

setInterval(discover, 60 * 60 * 1000);
discover(); // 즉시 1회
```

실패 시 `logger.error` + DDB `meta#discoverable_error` 기록. 다음 cycle 재시도.

### 4.6 Schemas & Error Handling

**Zod schemas** (전부 shared/src/schemas/):
- `Project`: yaml load 시 검증 → invalid면 startup fail (api), or skip + log (worker GitHub discoverer)
- `Account`: 동일
- `DdbStateRecord`, `DdbJobRecord`, `DdbHistoryRecord`: DDB read 후 검증

**AWS SDK v3 retry config**:
```ts
const baseConfig = {
  maxAttempts: 3,
  retryStrategy: new AdaptiveRetryStrategy(() => Promise.resolve('default')),
};
```

**Error classes** (`shared/src/errors.ts`):
```ts
export class TransientError extends Error { /* retryable */ }
export class PermanentError extends Error { /* immediate fail */ }
export class ConflictError extends Error { /* 5s 후 1회 재시도 */ }
export class AssumeRoleFailedError extends Error { /* clear message */ }
```

**전역 핸들러** (api):
- `TransientError` → 503
- `PermanentError` → 4xx (NotFound→404, Forbidden→403, ValidationException→400)
- `ConflictError` → 409
- 기타 → 500

**Worker**:
- `TransientError` → SQS message는 visibility timeout 만료 → 자동 재배달 (멱등이라 안전)
- `PermanentError` → DDB jobs status=`failed`, SQS message DeleteMessage (재시도 안 함)
- `partial_failure`: 일부 리소스만 실패 시 — 성공분은 DDB state restoration_data에 기록, status=`partial_failure`

---

## 5. Implementation Phases

각 phase는 독립 PR. Atlantis가 Terraform, GHA가 코드.

### 5.1 Phase 1 — Backend foundations (code-first, infra 무관)

**Goal**: 로컬 LocalStack으로 turn_off/turn_on이 unit + integration test 통과.

| # | 작업 |
|---|---|
| 1.1 | `dashboard/backend/` monorepo scaffold (pnpm, tsconfig, eslint, prettier, vitest) |
| 1.2 | `shared/` 패키지: Zod schemas, logger, errors, AWS client factory, DDB clients, assume-role helper |
| 1.3 | `worker/` 컨트롤러 4종 (ECS, EC2, RDS, ArgoCD) — unit + LocalStack integration. ArgoCD는 in-test HTTP mock |
| 1.4 | `worker/` job-runner (turn-off, turn-on) + SQS poll loop + startup sweep |
| 1.5 | `api/` Fastify 서버 + routes + JWT middleware (`NODE_ENV=development` skip mode) |
| 1.6 | `worker/` GitHub discoverer (PAT) — 1h cron + 즉시 1회 |
| 1.7 | Dockerfile × 2 (api, worker), multi-stage 빌드 |
| 1.8 | `.github/workflows/backend-ci.yml`: PR에서 lint/typecheck/test. push 동작은 Phase 3에서 활성 |
| **DoD** | `cd dashboard/backend && pnpm test` 통과. docker-compose로 LocalStack 띄우고 통합 테스트 통과. |

### 5.2 Phase 2 — Foundational infra (DDB + IAM + Secrets + SQS + ECR)

**Goal**: ECS task가 실행될 수 있는 IAM/state 기반 완성.

| # | 작업 |
|---|---|
| 2.1 | `infra/dynamodb/` — 3 tables, GSI1 on jobs, prevent_destroy, deletion_protection |
| 2.2 | `infra/iam/dashboard-ecs-task-role.tf` + `dashboard-ecs-exec-role.tf` |
| 2.3 | `infra/target-accounts/atomoh-main/` — `DemoPlatformOperator` (cross-account provider with assume-role to atomoh-main Terraformer) |
| 2.4 | `infra/sqs/` — queue + DLQ |
| 2.5 | `infra/secrets-manager/` — empty slots |
| 2.6 | (수동) Secrets Manager 값 채우기: GitHub PAT 발급, operator ExternalId 발급 (uuid), ArgoCD admin token 발급 |
| 2.7 | `infra/ecr/` — repo + lifecycle |
| **DoD** | Terraform plan 깨끗. DDB 테이블 콘솔 확인. SQS send/receive 수동 검증. `aws sts assume-role --role-arn arn:...DemoPlatformOperator --external-id <id>` 통과 (DashboardEcsTaskRole creds로). |

### 5.3 Phase 3 — Image push (GHA 활성)

**Goal**: PR 머지마다 ECR에 이미지 푸시.

| # | 작업 |
|---|---|
| 3.1 | `.github/workflows/backend-ci.yml` 확장: main 머지 시 build + push `<sha>` + `main-latest` |
| 3.2 | `infra/iam/gha-ecr-push-role.tf` — GHA OIDC trust (이미 있으면 권한 확장만) |
| **DoD** | main에 commit push → ECR에 새 이미지 보임. |

### 5.4 Phase 4 — ECS deploy + ALB + CF + R53 + Cognito

**Goal**: api + worker가 hub VPC에서 동작. CF endpoint 200.

| # | 작업 |
|---|---|
| 4.1 | `infra/dashboard-ecs/cluster.tf` + `task-definitions.tf` × 2 (initial image = Phase 3의 `<sha>` 명시. `ignore_changes`) |
| 4.2 | `infra/dashboard-ecs/api-service.tf` + `worker-service.tf` (desiredCount=1) |
| 4.3 | `infra/dashboard-ecs/log-groups.tf` (CloudWatch logs) |
| 4.4 | `infra/alb-internal/` 확장: admin-api-dev TG + listener rule (host header) |
| 4.5 | `infra/cloudfront/` 확장: admin-api-dev distribution + VPC Origin → ALB |
| 4.6 | `infra/route53-{private-zone,public}/` — admin-api-dev.atomai.click A |
| 4.7 | `infra/cognito/` — User Pool + App Client. 수동: atomoh user 등록 |
| 4.8 | (수동) Cognito 값을 Secrets Manager에 채움 (`app-client-id`, `user-pool-id`) |
| 4.9 | `.github/workflows/backend-ci.yml` 추가: main 머지 후 `aws ecs update-service --force-new-deployment` × 2 |
| **DoD** | `curl https://admin-api-dev.atomai.click/health` → 200. SQS 메시지 수동 send → worker 로그에 처리 확인. Cognito Hosted UI로 로그인 → access_token 발급 가능. |

### 5.5 Phase 5 — End-to-end (실 ECS service on/off 검증)

**Goal**: 실 리소스를 토글 가능 확인.

| # | 작업 |
|---|---|
| 5.1 | `projects/test-target.yaml` — atomoh-main의 dummy ECS service (또는 영향 적은 기존 것). 사전 결정 필요 (OQ-S2-1) |
| 5.2 | Cognito Hosted UI로 access_token 발급 |
| 5.3 | `curl -H "Authorization: Bearer ..." POST .../api/projects/test-target/actions/turn_off` → 202 job_id |
| 5.4 | `GET /api/jobs/<id>` 폴링 → succeeded. AWS 콘솔에서 ECS service desiredCount=0 확인. DDB state status=`off`, restoration_data 확인. DDB history 1 entry 확인. |
| 5.5 | turn_on → 원상복구 확인 |
| 5.6 | (선택) EC2 1개 + RDS 1개 + ArgoCD App 1개로 동일 사이클 검증 |
| **DoD** | E2E 통과. Phase 1의 LocalStack 회귀 테스트도 그대로 통과. |

### Phase 의존성

```
Phase 1 (code)           ──┐
Phase 2 (foundational)   ──┤
                             ├──► Phase 4 (deploy)  ──► Phase 5 (E2E)
Phase 3 (image push)     ──┘
```

Phase 1과 2는 병렬. Phase 3은 2.7 이후. Phase 4는 1+2+3 이후. Phase 5는 마지막.

---

## 6. Risks

| # | Risk | Impact | 완화 |
|---|---|---|---|
| R-1 | atomoh-main에 `DemoPlatformOperator` 만들 때 cross-account provider 권한 부족 | Phase 2.3 차단 | Stage 1 retrospective 확인: Terraformer는 PowerUser. IAM:Create/AttachPolicy 가능. plan에서 확인 |
| R-2 | SQS visibility timeout 5분 < RDS turn_on (5-10분) | 중복 작업 | RDS는 즉시 ack + background poll. 멱등성 |
| R-3 | ECS task SIGTERM 시 진행 중 job 손실 | 일관성 | DDB jobs status=`running` 인 잡을 worker 부팅 직후 sweep로 재처리. 멱등 |
| R-4 | Cognito JWT 검증 latency | API 응답 느림 | JWKS 메모리 캐싱 (TTL 24h) |
| R-5 | Operator trust policy 오타 → AssumeRole 영구 실패 | Stage 2 차단 | Phase 2 DoD에 CLI 검증 필수 |
| R-6 | GitHub PAT 만료 | discoverer 침묵 실패 | 401 detect → DDB `meta#discoverable_error` 기록. 알림은 Stage 4 |
| R-7 | ArgoCD admin token rotate 어려움 | 401 시 수동 작업 | v0.X에서는 수동. Stage 4에서 SA 토큰 |
| R-8 | LocalStack STS AssumeRole 시뮬레이션 한계 | 통합 테스트 갭 | AssumeRole helper는 unit test로 모킹, AWS 실 환경은 Phase 5에서 검증 |
| R-9 | ECS task-def에 박힌 image `<sha>`가 ECR에 없으면 부팅 실패 | Phase 4 실패 | task-def `ignore_changes=[container_definitions]`. Phase 3 후 Phase 4 진행 |
| R-10 | Cognito Pool 도메인 변경 시 재배포 부담 | 운영 마찰 | v0.X 동안 도메인 고정 |
| R-11 | DDB throttling (적은 트래픽이지만 GSI hot key) | 일시 응답 실패 | PAY_PER_REQUEST는 partition adaptive. on-demand는 4xx 거의 없음. 모니터링 |
| R-12 | LocalStack docker-compose가 dev environment 별로 다른 포트 | 충돌 | 표준 포트 (4566). pnpm script에서 docker-compose up |

---

## 7. Open Questions (구현 중 결정)

| # | 질문 | 결정 시점 |
|---|---|---|
| OQ-S2-1 | `projects/test-target.yaml`이 가리킬 ECS service — 신규 dummy or 기존? | Phase 5 시작 전 |
| OQ-S2-2 | ArgoCD admin token이 현재 어디에 — Secrets Manager에 password만, token은 발급 필요 | Phase 1.3 ArgoCD controller 구현 전 |
| OQ-S2-3 | atomoh-main Terraformer가 IAM role 생성 가능 권한 충분한지 | Phase 2.3 plan 단계 |
| OQ-S2-4 | LocalStack 무료 tier가 STS AssumeRole 충분 지원하는지 | Phase 1.3 |
| OQ-S2-5 | api task vs worker task subnet/SG — 공유? 분리? | Phase 4.2 |
| OQ-S2-6 | ECS 첫 배포 시 task-def initial image placeholder 처리 | Phase 4.1 |
| OQ-S2-7 | dashboard/backend 의존성 버전 lock 정책 (Renovate?) | Phase 1.1 |
| OQ-S2-8 | Cognito Pool 도메인 — `login.atomai.click` 사용? Cognito default? | Phase 4.7 |

---

## 8. Stage 2 DoD (전체)

- [ ] DDB `state-dev`, `jobs-dev`, `history-dev` 콘솔 확인
- [ ] `DashboardEcsTaskRole-dev`, `DemoPlatformOperator` (atomoh-main) cross-account AssumeRole CLI 검증
- [ ] ECR `demo-platform/backend` repo + GHA 자동 push
- [ ] ECS cluster + api/worker 서비스 각 1 task Running
- [ ] `https://admin-api-dev.atomai.click/health` → 200 (CF + ALB + ECS)
- [ ] Cognito Pool + atomoh user + Hosted UI 로그인 → access_token 발급
- [ ] JWT 검증된 호출만 비-health endpoint 접근 가능
- [ ] `POST /api/projects/test-target/actions/turn_off` → SQS → worker → ECS desiredCount=0 → DDB 정합
- [ ] `turn_on` 원상복구
- [ ] DDB state=`transitioning` 중 재요청 → 409
- [ ] worker 재시작 후 `running` 잡 sweep 재처리 검증
- [ ] GitHub discoverer 1h cycle DDB `meta#discoverable` 갱신
- [ ] LocalStack unit + integration test PR CI 통과
- [ ] Atlantis 모든 Terraform PR plan/apply

---

## Appendix A: Stage 1 결과물 재사용

Stage 1에서 이미 만든 것:
- `accounts.yaml` — atomoh-main 1개 (Stage 2에서 그대로 사용)
- `projects/multi-region-mall.yaml`, `projects/call-center-admin.yaml` — Stage 2 test-target은 신규
- `infra/alb-internal/`, `infra/cloudfront/`, `infra/route53-private-zone/` — Stage 2에서 extend (admin-api-dev listener / distribution / records 추가)
- `infra/atlantis-bootstrap/` — Stage 2의 `target-accounts/atomoh-main/` apply 가능 권한 보유
- ArgoCD self-managed + master-system-root — Stage 4에서 system 컴포넌트 등록 가능
- `external-secrets` + `cluster-secret-store` — Stage 3에서 backend가 SecretSync 가능

## Appendix B: 비용 추정 (dev, 월)

| 항목 | 추정 |
|---|---|
| ECS Fargate api (1 task, 0.5 vCPU, 1 GB) | $14 |
| ECS Fargate worker (1 task, 0.5 vCPU, 1 GB) | $14 |
| DDB on-demand (소 트래픽) | $1 |
| SQS (소 트래픽) | $0.5 |
| Cognito (MAU < 50000) | 무료 |
| CloudFront (10 GB out) | $0.85 |
| ECR storage (10 GB) | $1 |
| CloudWatch Logs (1 GB) | $0.5 |
| Secrets Manager (5 secrets) | $2 |
| **합계** | **~$34/월** |

Stage 1 비용에 추가되는 부분.
