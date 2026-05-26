# AWS Demo Platform — Design Specification

**Date**: 2026-05-26
**Author**: atomoh (collaborative brainstorming)
**Status**: Draft (pending implementation)
**Related repos**: `Atom-oh/AWS-Demo-Platform` (this), `Atom-oh/multi-region-architecture`

## Executive Summary

AWS Demo Platform은 atomoh 본인의 여러 GitHub 기반 데모 프로젝트(multi-region-architecture, code-server EC2, 친구 프로젝트 등)를 단일 관리자 콘솔에서 가시화하고 on/off 제어하는 admin 플랫폼이다. 비프로덕션 환경이며, 데모 비시연 시간 동안 컴퓨트 리소스를 끄고 시연 시 빠르게 켤 수 있게 하여 비용을 절감하는 것이 핵심 목적이다.

관리 대상은 ECS, EC2, ArgoCD Application(EKS 워크로드)이며, 정지 불가능한 RDS·DynamoDB·ElastiCache·MSK는 always-on으로 가시화·secret 관리만 제공한다. 3-5개의 독립 AWS 계정(서로 다른 Organization)을 cross-account assume-role + ExternalId로 제어한다.

플랫폼 자체는 dashboard (ECS Fargate, Next.js + Node.js TS)와 lifecycle controller로 구성되며, hub cluster(`mall-apne2-mgmt`, EKS in ap-northeast-2)에 ArgoCD/Atlantis/관측 스택을 둔다. multi-region-architecture는 이 hub의 tenant로 동작한다.

---

## 1. Goals, Non-goals, Stages

### 1.1 Goals

1. **여러 GitHub repo 기반 프로젝트들을 한 곳에서 가시화·제어** — 마스터-디테일 UI
2. **데모 외 시간에는 리소스를 끄고 데모 시에만 켬** — 가벼운 off (stop / desiredCount=0 / replicas=0), 빠른 복원
3. **3-5개 AWS 계정 (다른 Org)을 cross-account assume-role로 제어** — ExternalId 사용
4. **hub cluster를 단독 정의·소유** — 시스템 컴포넌트(ArgoCD, Prometheus, ClickHouse, Grafana 등)는 이 repo의 `k8s/system/`. 테넌트 프로젝트(multi-region-architecture 포함)는 `argocd-apps/tenants/`에 root Application CR로 등록 (App-of-Apps).
5. **각 프로젝트의 데모 URL, code-server URL, Secret Manager 작업을 UI에서 제공**
6. **Terraform 변경은 PR 기반 자동화** — Atlantis가 hub 클러스터에서 plan/apply 처리

### 1.2 Non-goals

- 멀티 사용자 / RBAC / 감사 로그 (v1 범위 외, Stage 4 이후 검토)
- 자동 데모 스케줄링 (cron 기반 9~18시 자동 ON 등) — Stage 4
- 비용 분석 대시보드 (Cost Explorer 통합 등)
- 워크플로우 오케스트레이션 (Step Functions, Airflow 등)
- 데모 데이터 시드 자동 주입
- multi-region-mall 워크로드 코드의 이전 (해당 repo에 그대로)
- True production-grade HA/DR
- 컴플라이언스 (SOC2/PCI/GDPR 등)

### 1.3 Stages

| Stage | 결과물 | 의존 |
|---|---|---|
| **1. Infra Migration** | multi-region-architecture의 mgmt cluster Terraform/k8s 정의를 이 repo로 이전. ArgoCD가 양쪽 sync. Atlantis 동작. CloudFront + VPC Origins + Internal ALB + TGB 패턴 도입. | 없음 |
| **2. Lifecycle Controller** | ECS Fargate backend. 3-5 계정 assume-role. ECS/EC2/ArgoCD app on/off + 상태 복원. DynamoDB 상태 추적. | Stage 1 |
| **3. Dashboard UI** | ECS Fargate Next.js frontend. master-detail. GitHub 자동 발견 + UI 메타데이터 보강. Secret Manager 추가, code-server URL 표시. Cognito 인증. | Stage 2 |
| **4. (선택) 운영 보강** | RBAC, 감사 로그, 스케줄러, 알림, 진짜 0 pod 지원 (HPA-3/4) 등 | Stage 3 |

### 1.4 Key Assumptions

1. **`mall-apne2-mgmt` 클러스터를 hub로 유지** — 이름은 historical artifact, 코드에선 `mgmt_cluster` 변수로 추상화. Karpenter로 노드 자동 확장. EKS 이름 변경(재생성)은 Stage 4 검토.
2. **AWS-Demo-Platform이 hub의 단독 owner.** multi-region-architecture는 spoke 클러스터들만 정의. hub의 ArgoCD가 multi-region-architecture를 포함한 외부 repo를 source로 sync (App-of-Apps).
3. **각 대상 계정에 IAM Role 2개씩 본인이 셋업.** 친구 계정 셋업은 본인이 가이드 제공 + 가능 시 직접 작업.
4. **비프로덕션 — 장애·중단·끊김 허용** ([[non-production-tolerance]]). multi-region-architecture도 동일.

---

## 2. Architecture & Components

### 2.1 ECS 서비스 (atomoh 메인 계정, ap-northeast-2)

dev/prod 두 환경 각각:

| 서비스 (env별 4개 total) | 이미지 | 포트 | 책임 |
|---|---|---|---|
| `demo-platform-frontend-{env}` | Next.js standalone | 3000 | 마스터-디테일 UI · Cognito 인증 진입점 · API 콜 |
| `demo-platform-backend-{env}` | Node.js TS | 8080 | REST API · cross-account assume-role · DynamoDB · GitHub API · ArgoCD API (k8s direct or REST) |

모두 Fargate, Internal ALB 뒤에 배치. ECR 사설 레지스트리 사용.

### 2.2 IAM Roles

```
[atomoh main account]
  DashboardEcsTaskRole-{env}      ← ECS dashboard task가 사용
    Trust: ecs-tasks.amazonaws.com
    Permissions:
      - sts:AssumeRole on DemoPlatformOperator/* (모든 대상 계정)
      - dynamodb:* on demo-platform-{state,jobs,history}-{env} tables
      - secretsmanager:GetSecretValue on /demo-platform/{env}/*
      - logs:* (CloudWatch)
      - eks:DescribeCluster + sts:GetCallerIdentity (k8s API auth용)
      - ecr:Get* (이미지 pull은 ECS execution role과 별개)

  AtlantisIRSARole                 ← EKS hub의 Atlantis pod
    Trust: hub OIDC + serviceaccount=atlantis
    Permissions:
      - sts:AssumeRole on DemoPlatformTerraformer/* (모든 대상 계정)
      - s3 access to terraform state bucket
      - secretsmanager:GetSecretValue on /demo-platform/atlantis/*
      - dynamodb access for terraform state lock (if not S3 native lockfile)

[각 대상 계정 #1~#5]
  DemoPlatformOperator             ← Dashboard 런타임용 (좁은 권한)
    Trust: DashboardEcsTaskRole-{env} + ExternalId 매칭
    Permissions: ECS·EC2·RDS·SecretsManager·DynamoDB(describe만)·ElastiCache(describe만)·MSK(describe만)

  DemoPlatformTerraformer          ← Atlantis용 (넓은 인프라 권한)
    Trust: AtlantisIRSARole + 별도 ExternalId
    Permissions: PowerUserAccess 또는 사용자 정의 (VPC/EKS/RDS 등 CRUD)
```

**역할 분리 이유**: 런타임과 인프라 변경은 blast radius가 다름. dashboard 토큰 탈취 시 인프라 파괴로 이어지지 않도록.

### 2.3 DynamoDB (atomoh 메인 계정)

env별 테이블 set. on-demand billing.

| 테이블 | PK / SK | 용도 |
|---|---|---|
| `demo-platform-state-{env}` | pk=`project#<repo>`, sk=`current` | 프로젝트별 현재 ON/OFF 상태 + restoration_data |
| `demo-platform-jobs-{env}` | pk=`job#<uuid>` (GSI1: project) | 비동기 작업 추적 |
| `demo-platform-history-{env}` | pk=`project#<repo>`, sk=`<iso8601>#<uuid>` | 액션 감사 로그 |

자세한 schema는 Section 3.

### 2.4 Secrets Manager (atomoh 메인 계정)

env별 분리 (path):

```
/demo-platform/
  ├── github-pat                              # (env 무관) repo 스캔용
  ├── {env}/
  │   ├── cognito/app-client-id
  │   ├── cognito/app-client-secret
  │   ├── argocd/admin-token                  # backend → ArgoCD (k8s API 사용 시 불필요)
  ├── atlantis/                               # (env 무관)
  │   ├── github-app-id
  │   ├── github-app-installation-id
  │   ├── github-app-private-key
  │   └── github-webhook-secret
  └── external-ids/
      ├── atomoh-main/operator
      ├── atomoh-main/terraformer
      ├── friend-A/operator
      ├── friend-A/terraformer
      └── ...
```

### 2.5 네트워크 — CloudFront + VPC Origins + Internal ALB + TGB

```
User
  │
  ▼
CloudFront (custom domain, WAF, ACM us-east-1)
  │  AWS 내부 백본
  ▼
VPC Origin (managed ENI in atomoh main VPC)
  │
  ▼
Internal ALB ← Terraform
  type: "internal"  (public IP 없음)
  SG: 1) CloudFront VPC Origin SG  2) 10.0.0.0/8
  Listener rule: host/path 매칭
  │
  ▼
Target Group ← Terraform (IP target type)
  │
  ├──→ EKS pods via TargetGroupBinding (TGB)
  ├──→ ECS Fargate tasks (direct)
  └──→ EC2 instances
```

**Internal ALB SG:**
```hcl
resource "aws_security_group" "alb_internal" {
  ingress {
    from_port                = 443
    to_port                  = 443
    protocol                 = "tcp"
    source_security_group_id = aws_cloudfront_vpc_origin.this.security_group_id
    description              = "CloudFront VPC Origin ENI"
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "Internal VPC + peered networks (RFC1918 subset)"
  }
}
```

**TGB 매니페스트 패턴 (k8s 측):**
```yaml
apiVersion: elbv2.k8s.aws/v1beta1
kind: TargetGroupBinding
metadata:
  name: argocd-server
  namespace: argocd
spec:
  serviceRef:
    name: argocd-server
    port: 80
  targetGroupARN: <Terraform output>
  targetType: ip
```

**도메인 매핑:**

| 컴포넌트 | 도메인 (prod) | dev 도메인 |
|---|---|---|
| dashboard-frontend | `admin.atomai.click` | `admin-dev.atomai.click` |
| dashboard-backend | `admin-api.atomai.click` 또는 frontend와 동일 host + path | `admin-api-dev.atomai.click` |
| Atlantis | `atlantis.atomai.click` | (dev에서 사용 안 함, prod만) |
| ArgoCD UI | `argocd.atomai.click` | 단일 (env 무관) |
| multi-region-mall | `mall.atomai.click` | (기존 유지) |
| code-server (atomoh) | `atomoh.code.atomai.click` (기존) | 동일 |

**Split-horizon DNS (D1):**
- public zone (Route 53 public): 위 도메인들 → CloudFront
- private zone (Route 53 PHZ, atomoh main VPC attached): 위 도메인들 → Internal ALB

backend가 hub의 ArgoCD를 호출할 때 같은 `argocd.atomai.click` 도메인 사용. private zone이 우선 resolve되어 ALB로 직접.

### 2.6 컴포넌트 의존성 흐름

```
User → CF → Internal ALB → frontend
                              │
                              ▼
                          backend → DynamoDB (state, jobs, history)
                              │
                              ├──→ AWS SDK v3 (cross-account) → target accounts
                              ├──→ ArgoCD API or k8s API → hub cluster
                              ├──→ GitHub API (PAT)         → repo 자동 발견
                              └──→ Secrets Manager           → 비밀 조회
```

### 2.7 관리자 인증 (Cognito)

```
[User] → CF → ALB → frontend (Next.js + Amplify Auth)
  │
  ▼ redirect to Cognito Hosted UI
Cognito User Pool (atomoh-demo-platform-{env})
  - 허용 사용자: atomoh 1명 등록, sign-up 비활성
  - MFA: optional (TOTP)
  - Custom domain: login.atomai.click (선택)
  │
  ▼ OAuth Authorization Code → JWT
Frontend: Next.js API route로 httpOnly secure cookie 저장
  │
  ▼ API call: Authorization: Bearer <access_token>
Backend:
  1. JWT 검증 (Cognito JWKS)
  2. cognito:username claim 추출
  3. allow list 검증 (ADMIN_USERNAMES env var)
  4. 통과 시 처리
```

### 2.8 Atlantis on hub cluster

```
k8s/system/atlantis/
  ├── deployment.yaml
  ├── service.yaml                 # ClusterIP
  ├── tgb.yaml                     # TargetGroupBinding → Internal ALB
  ├── irsa-serviceaccount.yaml     # AtlantisIRSARole annotation
  ├── server-config-secret.yaml    # config.yaml (repos, workflows)
  └── external-secret.yaml         # GitHub App credentials (Secrets Manager → k8s Secret)

argocd-apps/system/atlantis.yaml   # ArgoCD가 self-manage
```

**책임:**
- GitHub webhook 수신 → `atlantis plan` / `atlantis apply`
- Terraform state는 기존 S3 (`multi-region-mall-terraform-state`) 공유
- 두 repo 모두 manage (AWS-Demo-Platform + multi-region-architecture)

**multi-repo 설정:**
```yaml
# Atlantis server-side config
repos:
  - id: github.com/Atom-oh/AWS-Demo-Platform
    workflow: standard
    apply_requirements: [approved, mergeable]
  - id: github.com/Atom-oh/multi-region-architecture
    workflow: standard
    apply_requirements: [approved, mergeable]
```

### 2.9 Bootstrap 순서

```
1. (수동, local terraform apply, 1회) infra/atlantis-bootstrap/
   → AtlantisIRSARole, target account roles 슬롯, S3 backend 확인, Atlantis용 Secrets 슬롯

2. (수동) GitHub App 생성 + Secrets Manager에 credentials 입력

3. (수동, kubectl apply, 1회) k8s/system/atlantis/ 매니페스트
   → Atlantis pod 기동

4. 이후 모든 변경은 PR로 → Atlantis가 plan/apply
   포함: AWS-Demo-Platform/infra/* + multi-region-architecture/terraform/*
```

---

## 3. Data Model

### 3.1 `accounts.yaml` (git, 정적)

```yaml
accounts:
  - name: atomoh-main
    account_id: "777788889999"
    region: ap-northeast-2
    roles:
      operator:
        arn: arn:aws:iam::777788889999:role/DemoPlatformOperator
        external_id_secret: /demo-platform/external-ids/atomoh-main/operator
      terraformer:
        arn: arn:aws:iam::777788889999:role/DemoPlatformTerraformer
        external_id_secret: /demo-platform/external-ids/atomoh-main/terraformer

  - name: friend-A
    account_id: "111122223333"
    region: ap-northeast-2
    roles:
      operator:
        arn: arn:aws:iam::111122223333:role/DemoPlatformOperator
        external_id_secret: /demo-platform/external-ids/friend-A/operator
      terraformer:
        arn: arn:aws:iam::111122223333:role/DemoPlatformTerraformer
        external_id_secret: /demo-platform/external-ids/friend-A/terraformer
```

env과 무관 (어느 환경의 backend든 같은 대상 계정 제어).

### 3.2 `projects/<repo>.yaml` (git, 정적 메타)

```yaml
name: api-playground
github:
  repo: Atom-oh/api-playground
  branch: main
description: API experiment playground
account: friend-A
display:
  category: experiment

resources:
  # On/off 대상
  - type: ecs
    cluster: friend-cluster
    service: api-playground-svc

  - type: ec2
    instance_ids: [i-0123456789abcdef0]

  - type: argocd-app
    application: api-playground
    cluster: mall-apne2-mgmt
    workload_selector:
      namespace: api-playground
    hpa_handling: scale_to_one   # 기본값. options: ignore, delete (Stage 4)

  # Always-on (가시성만)
  - type: rds
    db_identifier: api-playground-db
    always_on: true               # RDS는 stop 가능하나 7일 한정 — 명시적 always_on 선택 가능

  - type: dynamodb
    table_names: [users, sessions]
    always_on: true

  - type: elasticache
    cluster_id: api-cache-001
    always_on: true

urls:
  demo: https://api-demo.atomai.click
  code_server:
    mode: explicit
    url: https://api-code.atomai.click

secrets:
  manage_prefix: /api-playground/
```

backend가 등록 시 schema 검증 (Zod). 잘못된 reference는 PR에서 lint으로 거부.

### 3.3 DynamoDB 테이블 상세

#### Table A: `demo-platform-state-{env}`

| Attribute | Type | Description |
|---|---|---|
| `pk` | S (PK) | `project#api-playground` |
| `sk` | S (SK) | `current` (고정) |
| `status` | S | `on` / `off` / `transitioning` / `error` |
| `last_action` | S | `turn_on` / `turn_off` / `init` |
| `last_action_at` | S | ISO8601 |
| `last_actor` | S | `atomoh` |
| `restoration_data` | M | 복원 정보 |
| `error_message` | S | 마지막 실패 메시지 |
| `updated_at` | S | ISO8601 |

`restoration_data` 예시:
```json
{
  "ecs": {"cluster": "friend-cluster", "service": "api-svc", "original_desired_count": 2},
  "argocd": {
    "application": "api-playground",
    "workloads": {"api-deployment": 3, "worker-deployment": 1},
    "hpas": {"api-hpa": {"min": 2, "max": 10}}
  },
  "ec2": [{"instance_id": "i-0123", "previous_state": "running"}]
}
```

#### Table B: `demo-platform-jobs-{env}`

| Attribute | Type | Description |
|---|---|---|
| `pk` | S (PK) | `job#<uuid>` |
| `gsi1pk` | S (GSI1 PK) | `project#api-playground` |
| `gsi1sk` | S (GSI1 SK) | `<iso8601>` |
| `operation` | S | `turn_on` / `turn_off` / `add_secret` |
| `status` | S | `pending` / `running` / `succeeded` / `failed` / `partial_failure` |
| `progress` | M | `{ecs: done, argocd: in_progress, ec2: pending}` |
| `error` | S | |
| `created_at`, `started_at`, `completed_at` | S | |
| `ttl` | N | 7일 후 자동 삭제 |

#### Table C: `demo-platform-history-{env}`

| Attribute | Type | Description |
|---|---|---|
| `pk` | S (PK) | `project#api-playground` |
| `sk` | S (SK) | `<iso8601>#<uuid>` |
| `action` | S | |
| `actor` | S | |
| `account` | S | `friend-A` |
| `result` | S | `success` / `failure` |
| `details` | M | 전체 컨텍스트 |
| `ttl` | N | 90일 |

### 3.4 git 디렉토리 구조

```
AWS-Demo-Platform/
├── accounts.yaml
├── projects/
│   ├── api-playground.yaml
│   ├── ml-workshop.yaml
│   └── multi-region-mall.yaml          # multi-region-architecture를 1개 project로 등록
├── infra/                              # Terraform
│   ├── modules/                        # mgmt 사용 분 (multi-region-architecture에서 이전)
│   ├── eks-mgmt/                       # mall-apne2-mgmt 클러스터
│   ├── cloudfront/                     # CF distributions + VPC Origins
│   ├── alb-internal/                   # Internal ALBs + listener rules
│   ├── route53-private-zone/           # Split-horizon DNS PHZ
│   ├── atlantis-bootstrap/             # Atlantis IRSA + S3 backend + per-account roles
│   ├── cognito/                        # User Pool, App Clients
│   ├── dynamodb/                       # state/jobs/history tables
│   ├── dashboard-ecs/                  # ECS cluster + services + TG
│   ├── iam/                            # DashboardEcsTaskRole, AtlantisIRSARole
│   └── global/state-bucket/            # (이전 시 terraform state bucket 정의)
├── k8s/system/                         # hub-only 컴포넌트
│   ├── argocd/                         # (argocd-korea/에서 이전)
│   ├── argocd-cm-patch/                # ignoreDifferences 설정
│   ├── atlantis/
│   ├── clickhouse-mgmt/                # logs/traces 스키마 포함
│   ├── prometheus-stack/
│   ├── grafana/
│   ├── karpenter-apne2-mgmt/
│   ├── actions-runner/
│   ├── runner-scheduler/
│   └── storageclass/
├── argocd-apps/
│   ├── system/                         # k8s/system/* self-managed
│   └── tenants/
│       ├── multi-region-mall.yaml      # multi-region-architecture/argocd/ 가리킴
│       └── ...
├── dashboard/                          # Stage 3
│   ├── frontend/                       # Next.js
│   └── backend/                        # Node.js TS API
├── docs/
│   └── superpowers/specs/
└── .github/workflows/
```

### 3.5 Secrets Manager 키 네임스페이스 (위 2.4와 동일)

### 3.6 Capacity 모드

- DynamoDB: **On-demand (PAY_PER_REQUEST)** — 트래픽 적음
- 별도 RCU/WCU 프로비저닝 없음
- DynamoDB 자체는 always-on (저비용)

---

## 4. On/Off Semantics

### 4.1 상태 머신

```
            turn_off          turn_off (error)
   ┌─── ON ─────────► transitioning ─────────► ERROR
   │                       │  │
   │                       │  └── retry → ON / OFF
   │                       ▼
   │                      OFF
   │                       │
   └─── turn_on ◄──────────┘
```

- `transitioning`: 다른 작업 거부 (409 Conflict)
- `error`: UI 표시, 재시도 또는 force-set-state 가능 (Stage 4)

### 4.2 리소스 종류별 동작

#### ECS Service
```
turn_off:
  1. describe-services → original_desired_count 기록
  2. update-service desiredCount=0

turn_on:
  1. update-service desiredCount=<original>
```

#### EC2 Instance
```
turn_off:
  1. describe-instances → state="running" 확인
  2. stop-instances

turn_on:
  1. start-instances
```

#### ArgoCD Application + HPA (HPA-2 단순화)

**사전 설정 (cluster-wide baseline):**
```yaml
# k8s/system/argocd-cm-patch/argocd-cm.yaml
data:
  resource.customizations.ignoreDifferences.apps_Deployment: |
    jsonPointers:
      - /spec/replicas
  resource.customizations.ignoreDifferences.apps_StatefulSet: |
    jsonPointers:
      - /spec/replicas
  resource.customizations.ignoreDifferences.autoscaling_HorizontalPodAutoscaler: |
    jsonPointers:
      - /spec/minReplicas
      - /spec/maxReplicas
```

**동작:**
```
turn_off:
  1. backend → hub k8s API (EKS IAM auth via DashboardEcsTaskRole)
  2. project namespace의 Deployment/StatefulSet/HPA 조회
  3. 각 HPA의 spec.minReplicas, maxReplicas → restoration_data.hpas
  4. patch HPA: minReplicas=1, maxReplicas=1
  5. 각 Deployment/StatefulSet의 replicas → restoration_data.workloads
  6. scale to 1 (HPA controlled) or 0 (no HPA)

turn_on:
  1. scale Deployment/StatefulSet to restoration_data.workloads[name]
  2. patch HPA back to restoration_data.hpas[name].{min, max}
```

→ ArgoCD Application 안 건드림. syncPolicy 안 건드림. HPA-managed deployment는 최소 1 pod 비용 ([[non-production-tolerance]] 수용).

#### RDS Instance
```
turn_off:
  1. describe-db-instances → status="available" 확인
  2. stop-db-instance
  3. UI에 7일 자동 시작 caveat 표시

turn_on:
  1. start-db-instance
  2. status="available" 도달까지 폴링 (~5분)
```

#### Always-on (DynamoDB, ElastiCache, MSK, optionally RDS)
- 토글 동작 없음, UI에 "always-on" 배지
- 엔드포인트 표시
- Secret Manager UI로 credential 추가 가능

### 4.3 Turn-Off 시퀀스

```
[User] → frontend → backend POST /api/projects/<X>/actions/turn_off
  │
  ▼
backend:
  1. projects/X.yaml + accounts.yaml 로드
  2. DDB read state, must be `on` (else 409)
  3. DDB write state.status=`transitioning`, create job#<uuid>
  4. Return 202 Accepted + job_id
  │
  ▼ (async worker loop)
  5. AssumeRole into target account (operator role)
  6. For each resource (skip always_on):
       execute turn_off action (per 4.2)
       update job.progress
  7. DDB write state.status=`off`, restoration_data, last_action_at
  8. DDB write job.status=`succeeded`
  9. DDB write history record
  │
  ▼ (frontend polling)
GET /api/jobs/<job_id> until terminal status
```

### 4.4 Turn-On 시퀀스

거의 대칭. 차이점:
- `restoration_data` 사용해 원본 값으로 복원
- RDS 등은 ready 도달 폴링 → job 완료 시점 더 김
- 모든 리소스 완료 후 demo URL 헬스체크 (HEAD) — Stage 4

### 4.5 에러 처리

| 에러 유형 | 동작 |
|---|---|
| AssumeRole 실패 | 즉시 fail, `error: "Cannot assume role in <account>"` |
| 일부 리소스만 실패 | 성공분까지 기록, state=`error` (또는 `partial_failure`), idempotent 재시도 |
| Throttling | 지수백오프 3회 |
| 타임아웃 (RDS 시작) | `pending_long`, 백그라운드 계속 폴링 |
| 동시 작업 | 409 Conflict |

비프로덕션이므로 partial failure는 사용자 수동 개입 허용.

### 4.6 GitHub repo 자동 발견

```
[cron, hourly] backend.discoverProjects()
  1. GitHub API (PAT): list repos in Atom-oh
  2. 필터: topic="demo-platform" 또는 전체
  3. projects/*.yaml과 매칭
  4. 결과 캐시: DDB state pk=`meta#discoverable`

[user] dashboard에서 "Register" 클릭
  → backend가 projects/<repo>.yaml 템플릿 생성 + PR 자동 생성
  → 머지 후 다음 cron에 known project로 인식
```

### 4.7 Code-server URL 표시

projects/<X>.yaml.urls.code_server.mode:
- `explicit` → URL 그대로 표시
- `ec2-tag` (Stage 4) → describe-instances로 자동 발견

### 4.8 Secret Manager UI

| 동작 | 권한 | 비고 |
|---|---|---|
| List secrets (manage_prefix) | secretsmanager:ListSecrets | 값은 안 가져옴 |
| Add new secret | secretsmanager:CreateSecret | UI 입력 후 plain submit (TLS) |
| Show secret value | ✗ | 의도적 제외 |
| Rotate / Delete / Edit | Stage 4 | |

### 4.9 Auth 흐름 (Section 2.7 참조)

---

## 5. Stage 1 Migration Plan

### 5.1 이전 / 유지 / 신규 분류

#### 이전 (multi-region-architecture → AWS-Demo-Platform)

**Terraform:**
```
environments/production/ap-northeast-2/eks-mgmt/   →  infra/eks-mgmt/
modules/  (mgmt 사용 분만)                          →  infra/modules/
global/terraform-state/                            →  infra/global/state-bucket/
```

**k8s/infra/ (mgmt 전용):**
```
argocd-korea/             →  k8s/system/argocd/
clickhouse-mgmt/          →  k8s/system/clickhouse-mgmt/  (로그/트레이스 스키마 추가)
prometheus-stack/         →  k8s/system/prometheus-stack/
grafana/                  →  k8s/system/grafana/
karpenter-apne2-mgmt/     →  k8s/system/karpenter-apne2-mgmt/
actions-runner/           →  k8s/system/actions-runner/
runner-scheduler/         →  k8s/system/runner-scheduler/
storageclass/             →  k8s/system/storageclass/
```

#### 유지 (multi-region-architecture에 잔류)

- `terraform/environments/production/ap-northeast-2/shared/` — VPC/SG/KMS/데이터 레이어
- `terraform/environments/production/{us-east-1,us-west-2,ap-northeast-2/eks-az-a,eks-az-c}/` — 워크로드 클러스터
- `terraform/global/{aurora,documentdb,route53-zone}/` — 워크로드 데이터/DNS
- `k8s/infra/{external-secrets,fluent-bit,otel-collector,keda}/` — 공유 agents (hub + 모든 spoke에 배포)
- `k8s/base/`, `k8s/services/`, `k8s/overlays/` — 워크로드 매니페스트
- `src/`, `webpage/`, `docker/`, `scripts/` — 앱 코드

#### 삭제 (사용 안 함)

- `k8s/infra/tempo/`, `tempo-west/` — ClickHouse로 대체
- `terraform/modules/observability/tempo-storage/` — 참조 제거
- `k8s/infra/argocd/` (suffix 없는 것) — 실제 사용 안 하면 (OQ-1 확정)

#### 신규 (AWS-Demo-Platform에서 처음)

```
infra/
├── atlantis-bootstrap/      # AtlantisIRSA + per-account roles + S3 (bootstrap layer)
├── cloudfront/              # CF distributions + VPC Origins
├── alb-internal/            # Internal ALBs (Atlantis, ArgoCD UI, dashboard)
├── route53-private-zone/    # Split-horizon DNS PHZ
├── cognito/                 # User Pool (Stage 3 시작 시)
├── dynamodb/                # state/jobs/history (Stage 2)
├── dashboard-ecs/           # ECS cluster + services (Stage 3)
└── iam/
    ├── dashboard-ecs-task-role.tf
    ├── atlantis-irsa-role.tf
    └── target-accounts.tf

k8s/system/
├── atlantis/                # 신규 (multi-region-architecture에 없음)
└── argocd-cm-patch/         # ignoreDifferences 추가

argocd-apps/
├── system/                  # 모든 system 컴포넌트 self-managed
└── tenants/
    ├── multi-region-mall.yaml
    └── ...

dashboard/                   # Stage 3
projects/                    # 정적 메타 yaml
accounts.yaml
```

### 5.2 multi-region-architecture에 새로 추가될 것

```
argocd/                              # 신규 — tenant 자식 Applications
├── shared-agents-hub.yaml           # hub에 external-secrets/fluent-bit/otel-collector/keda 배포
├── shared-agents-az-a.yaml          # 각 spoke에 동일 배포
├── shared-agents-az-c.yaml
├── shared-agents-us-east-1.yaml
├── shared-agents-us-west-2.yaml
├── workloads-us-east-1.yaml         # 워크로드 App
├── workloads-us-west-2.yaml
├── workloads-apne2-az-a.yaml
└── workloads-apne2-az-c.yaml
```

AWS-Demo-Platform/argocd-apps/tenants/multi-region-mall.yaml이 이 디렉토리를 가리킴 (App-of-Apps).

### 5.3 마이그레이션 접근 — Destructive Cutover

[[non-production-tolerance]] 적용. 다운타임 허용. 예상 2~4시간.

```
Step 1: 사전 준비 (multi-region-arch 정상 동작 중)
  - AWS-Demo-Platform repo 디렉토리 구조 생성
  - 이전 대상 파일 복사 (multi-region-arch에서 cp)
  - Terraform backend 키 유지
  - PR 리뷰 후 머지

Step 2: Atlantis 부트스트랩 (수동, 로컬 terraform)
  - infra/atlantis-bootstrap/ apply
  - 친구 계정에 DemoPlatformOperator + DemoPlatformTerraformer 셋업 (수동 가이드)
  - GitHub App 생성 + Secrets Manager에 credentials 입력
  - k8s/system/atlantis/ kubectl apply

Step 3: ArgoCD 재구성 (다운타임 허용)
  - 기존 ArgoCD 중지 (kubectl delete ns argocd 또는 helm uninstall)
  - 새 매니페스트로 재배포 (argocd-cm-patch 포함)
  - admin token Secrets Manager에 저장

Step 4: 시스템 컴포넌트 재배포 via ArgoCD
  - argocd-apps/system/* 등록
  - ArgoCD가 prometheus-stack, grafana, clickhouse-mgmt 등 sync
  - tempo/tempo-west는 배포 안 함, 데이터 손실 OK
  - ClickHouse에 logs/traces 테이블 스키마 적용

Step 5: Tenant 등록 + 공유 agents 재배포
  - multi-region-architecture에 argocd/ 디렉토리 PR
  - AWS-Demo-Platform/argocd-apps/tenants/multi-region-mall.yaml 등록
  - shared-agents가 hub + spokes에 배포됨
  - OTel-collector config: ClickHouse exporter로 변경 (Tempo exporter 제거)
  - fluent-bit output: ClickHouse로 변경

Step 6: 검증
  - 각 spoke 워크로드 정상 동작
  - Atlantis PR plan/apply 정상
  - Internal ALB + CF VPC Origin 도달 (ArgoCD UI, Atlantis UI public 접근)
  - ClickHouse에 logs/traces 정상 적재
  - Prometheus가 hub + spoke metrics 수집 (Section 7 OQ-7 결정 따라)
```

### 5.4 Terraform State 처리

- 현재 `multi-region-mall-terraform-state` S3 bucket의 `production/ap-northeast-2/eks-mgmt/terraform.tfstate`
- 이전 후: 같은 bucket의 같은 key를 새 repo가 가리킴. backend.tf 동일.
- terraform state physically untouched. Stage 4 이름 정리 시 `terraform state mv` 적용 가능.
- 새 인프라(atlantis-bootstrap, cloudfront 등)는 새 state key.

### 5.5 cross-repo `terraform_remote_state` 패턴

```hcl
# AWS-Demo-Platform/infra/eks-mgmt/main.tf (이전 후)
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = "multi-region-mall-terraform-state"
    key    = "production/ap-northeast-2/shared/terraform.tfstate"
    region = "us-east-1"
  }
}
```

shared/는 multi-region-arch가 소유. mgmt는 그 위에 얹힘. Atlantis가 두 repo 모두 plan/apply.

### 5.6 Stage 1 완료 정의 (DoD)

- [ ] AWS-Demo-Platform repo에 디렉토리 구조 + 이전 파일들 머지
- [ ] Atlantis가 PR `atlantis plan` 코멘트로 동작
- [ ] ArgoCD UI가 `argocd.atomai.click` (CF → Internal ALB → TGB)로 접근
- [ ] argocd-cm에 ignoreDifferences 적용
- [ ] root admin token Secrets Manager에 저장
- [ ] multi-region-mall 모든 spoke 워크로드가 hub ArgoCD에서 정상 sync (Healthy + Synced)
- [ ] multi-region-architecture mgmt 관련 디렉토리/파일 삭제 PR 머지
- [ ] 친구 계정 1~2개에 DemoPlatformTerraformer 역할 셋업 + Atlantis plan 동작 확인
- [ ] ClickHouse에 logs/traces 적재 확인 (Tempo 제거됨)
- [ ] Prometheus에 hub + 1개 이상 spoke metrics 수집 확인

### 5.7 위험 / 주의 (확장본은 Section 7)

- shared/ remote_state cross-repo coupling
- runner-scheduler / actions-runner 마이그 중 GitHub Actions 일시 중단 (OQ-4 무방 확정)
- ArgoCD 초기 부트스트랩 chicken-and-egg

---

## 6. Tech Details

### 6.1 테스팅 전략

| 컴포넌트 | 종류 | 도구 | MVP 범위 |
|---|---|---|---|
| Backend | Unit | Vitest | ✅ |
| Backend | Integration (DDB) | Vitest + LocalStack 또는 dev account | ✅ |
| Backend | Schema (Zod) | Vitest | ✅ |
| Frontend | Unit | Vitest + Testing Library | ✅ |
| Frontend | E2E | Playwright | Stage 4 |
| Terraform | validate/lint/fmt | Atlantis hooks | ✅ |
| k8s | kubeconform, kustomize build | GHA | ✅ |
| yaml schema | lint | GHA | ✅ |

비프로덕션이므로 강제 커버리지 기준 없음, 회귀 방지 수준.

### 6.2 에러 처리 패턴

**AWS SDK retry:**
```ts
const retryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryableErrors: ['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailable']
};
```

**에러 분류:**

| 종류 | 예 | 처리 |
|---|---|---|
| Transient | Throttling, 5xx, network | 지수백오프 3회 |
| Permanent | NotFound, Forbidden, ValidationException | 즉시 fail |
| Conflict | UpdateService 동시성 | 5초 대기 후 1회 |
| AssumeRole 실패 | InvalidIdentityToken, ExternalId mismatch | 즉시 fail, 명확한 메시지 |

**Idempotency:**
- 모든 mutate 작업은 멱등 (이미 desiredCount=0이면 skip 등)

### 6.3 Observability

```
모든 클러스터 (hub + spokes):
  workload pods → OTel SDK → otel-collector (DaemonSet)
                              │
                              ├──→ ClickHouse (mgmt cluster) [traces, logs]
                              └──→ Prometheus on mgmt (via remote_write)  [metrics]
                                    ↑
                                    │ remote_write push
                                    │
                              Spoke의 Prometheus(또는 OTel-collector) — 로컬 수집 후 mgmt로 push

fluent-bit (DaemonSet) → ClickHouse (logs)

ECS Tasks (dashboard):
  stdout/stderr → CloudWatch Logs (MVP). Stage 4에서 ClickHouse로 unify (Firehose 또는 fluent-bit sidecar)
  /metrics endpoint → ECS task 내 sidecar otel-collector → remote_write → mgmt Prometheus
  OTel SDK → otel-collector (hub) → ClickHouse
```

**Grafana datasources:**
- Prometheus (metrics)
- ClickHouse (logs, traces — Grafana ClickHouse plugin)

비프로덕션 → 알림·자동 복구 없음. 수동 조회.

### 6.4 CI/CD 파이프라인

```
.github/workflows/
├── terraform-validate.yml      # PR: tflint/fmt/validate (Atlantis와 별도 pre-check)
├── k8s-validate.yml            # PR: kubeconform, kustomize build
├── backend-ci.yml              # PR: lint/test/build. main 머지 시: image push to ECR
├── frontend-ci.yml             # PR: lint/test/build. main 머지 시: image push to ECR
├── projects-yaml-lint.yml      # PR: projects/*.yaml schema 검증
├── deploy-dashboard-dev.yml    # main 머지: ECS dev service update
├── deploy-dashboard-prod.yml   # tag v*.*.*: ECS prod service update
└── release-please.yml          # main 머지: release PR 자동 생성
```

**Atlantis vs GHA 역할:**

| | Atlantis | GHA |
|---|---|---|
| Terraform plan/apply | ✅ | ✗ |
| Code lint/test/build | ✗ | ✅ |
| Docker build & push | ✗ | ✅ |
| ECS task def 업데이트 | ✗ | ✅ |
| `aws ecs update-service` | ✗ | ✅ |
| k8s 매니페스트 sync | (ArgoCD) | ✗ |

### 6.5 ECS 배포 패턴

```hcl
resource "aws_ecs_service" "dashboard_backend" {
  name            = "demo-platform-backend-${var.env}"
  cluster         = aws_ecs_cluster.dashboard.id
  task_definition = aws_ecs_task_definition.dashboard_backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  lifecycle {
    ignore_changes = [task_definition, desired_count]
    # task_def는 GHA, desired_count는 lifecycle-controller가 담당
  }
}
```

GHA가 main 머지 시:
1. Build & push image `<sha>` to ECR
2. Register new task definition revision
3. `aws ecs update-service --force-new-deployment`

tag push 시 동일 흐름, prod service 대상.

롤백: 이전 task def revision으로 수동 update-service.

### 6.6 이미지 태깅 & ECR

- 태그: `<git-sha>` (immutable) + `<semver>` (tag 시) + `main-latest` (가변)
- ECR repos: `demo-platform/backend`, `demo-platform/frontend`
- Lifecycle: untagged 7일 후 삭제, tagged 30개 유지

### 6.7 로컬 개발

```bash
cd dashboard/backend && npm i
docker-compose up -d  # localstack
AWS_PROFILE=dev npm run dev

cd dashboard/frontend && npm i
npm run dev
```

`NODE_ENV=development` 일 때 JWT 검증 스킵 + 가상 사용자 주입. prod 빌드엔 포함 안 됨.

### 6.8 데이터베이스 마이그레이션

DynamoDB schema 대부분 additive. 새 attribute는 optional. Breaking change는 신규 테이블 + dual-write + cutover (Stage 4 이후).

### 6.9 브랜치 / 릴리스 전략

**환경 분리:**

| | dev | prod |
|---|---|---|
| 트리거 | `main` 머지 | git tag `v*.*.*` |
| 자원 | env suffix로 분리 (`*-dev`, `*-prod`) | |
| 둘 다 비프로덕션 | SLA 없음, 단 prod는 "stable demo" 상태 | |

**Semver (Conventional Commits 기반):**
- `v0.X.Y`: 1.0 이전 (현재). 모든 변경 허용.
- `v1.X.Y`: 1.0 이후. patch/minor/major bump 규칙 적용.

**Breaking change 정의:**
- API contract 변경 (frontend ↔ backend)
- DynamoDB schema breaking
- projects/accounts yaml schema 호환 안 됨
- Cognito 세션 무효화
- IAM role ARN/name 변경

**Tag 자동화: release-please** (Google) — conventional commits 기반 자동 PR + tag.

**첫 prod 릴리스:** v1.0.0 시점에 prod 인프라 신규 생성 + 최초 deploy. 그 전에는 dev만.

**자원 분리 단위:**

| 자원 | 분리 |
|---|---|
| EKS hub cluster | 같은 cluster, namespace 분리 |
| ECS cluster | 같은 cluster, 다른 service 4개 |
| Internal ALB / TG | 같은 ALB, 다른 listener rule + TG |
| CloudFront | 환경별 distribution |
| 도메인 | `admin.atomai.click` (prod), `admin-dev.atomai.click` (dev) |
| DynamoDB | env suffix |
| Cognito | 1 pool, App Client 2개 |
| Atlantis | 1개, workspace 분리 |
| ArgoCD on hub | 1개, Application 2개 (main 추적 + tag 추적) |
| Secrets Manager | path 분리 |
| IAM Roles | env suffix |

비용 추가: 약 $30~50/월 (Fargate task 추가).

---

## 7. Open Questions, Risks, Future Work

### 7.1 Open Questions (Stage 1 실행 중 확정)

| # | 질문 | 확인 방법 | 결정 시점 |
|---|---|---|---|
| OQ-1 | (해결됨) `argocd-korea/`가 hub 클러스터(ap-northeast-2)에 실제 배포. `argocd/`(suffix 없는 것)는 미사용이면 삭제 | — | ✓ |
| OQ-2 | `tempo/` 와 `tempo-west/` 의 실제 클러스터 배치 (참고용 — 어차피 삭제 대상) | k8s/overlays/* 검사 | 삭제 전 |
| OQ-3 | (해결됨) `external-secrets`, `fluent-bit`, `otel-collector`, `keda`는 워크로드 spoke에도 필요 → multi-region-arch에 잔류, hub + spokes에 모두 배포 | — | ✓ |
| OQ-4 | (해결됨) Actions runner 마이그 중 GitHub Actions 일시 중단 — 무방 | — | ✓ |
| OQ-5 | Karpenter `karpenter-apne2-mgmt`의 NodePool idle 시 노드 수 | 현재 NodePool spec 확인 | Stage 1 Step 4 |
| OQ-6 | shared/ remote_state 참조 시 두 repo 동시 변경 충돌 가능성 | Atlantis가 DynamoDB lock 사용 (이미 표준). 직렬화 | Stage 1 Step 2 |
| OQ-7 | (해결됨) spoke 클러스터 metrics → mgmt Prometheus는 **remote_write** 방식. 각 spoke의 Prometheus(또는 OTel-collector)가 mgmt cluster의 central Prometheus로 remote_write push | — | ✓ |

### 7.2 위험 (Risk Register)

| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| R-1 | State backend 공유로 cross-repo terraform 동시 lock 충돌 | Atlantis 실패 | Atlantis DynamoDB lock + 작업 직렬화 |
| R-2 | cross-repo terraform_remote_state coupling | shared/ 변경이 mgmt 영향 | Atlantis plan으로 양쪽 영향 가시화 |
| R-3 | Atlantis 부트스트랩 중 ArgoCD 미동작 — 매니페스트 적용 수단 임시 부재 | Step 2~3 사이 갭 | kubectl 직접 적용 (한 번만) |
| R-4 | ExternalId 노출 (PR diff, Issue 등) | 친구 계정 무단 접근 | Secrets Manager 보관. 노출 시 rotate |
| R-5 | Cognito 단일 admin lockout | 본인 로그인 불가 | AWS root 콘솔로 User Pool 직접 조작 가능 |
| R-6 | GitHub webhook 미동작 | Atlantis 정지 | 수동 trigger CLI. App 상태 모니터 |
| R-7 | 친구 계정 IAM Role 무단 변경 | 해당 계정 액션 실패 | 명확한 에러 + UI에서 "재 trust" 가이드 |
| R-8 | DynamoDB 테이블 실수 삭제 | 상태 손실 | Terraform `prevent_destroy=true`, deletion protection |
| R-9 | EKS 1.x 업그레이드 호환성 | breakage | PR + Atlantis plan 사전 검증 |
| R-10 | Terraform drift (콘솔 수동 변경) | 다음 apply 의도 외 동작 | Atlantis plan에서 drift 노출 |
| R-11 | Secret 노출 (PR diff 실수) | credential 유출 | Secrets Manager만 사용. git-secrets GHA |
| R-12 | 친구 onboarding ExternalId 전달 채널 | 보안 | 1:1 메신저 또는 본인이 친구 콘솔에서 작업 |
| R-13 | ClickHouse 스키마 호환성 (logs/traces 추가 시) | 기존 데이터 손실 가능 | 비프로덕션이므로 데이터 손실 OK |

### 7.3 명시적 Out of Scope

[[non-production-tolerance]] 와 일관:

- True production HA (multi-AZ Fargate, multi-region failover)
- 컴플라이언스 (SOC2/PCI/GDPR)
- 자동 패치 관리
- DR 테스트 / RPO·RTO
- 자동 비용 최적화
- 자동 보안 스캔 (Snyk/Dependabot은 GHA로 별도 가능)
- 페이지 로딩 성능 최적화

### 7.4 Stage 4 후속 작업

**관측성·운영:**
- Prometheus federation (ECS 메트릭 → mgmt)
- Slack/Discord 알림
- Grafana 대시보드 (action latency, error rate, 비용)
- 감사 로그 분석 UI

**자동화:**
- Scheduled on/off (cron 기반)
- Demo URL 헬스체크
- ALB introspection으로 code-server URL 자동 발견
- Secret rotation 자동화
- HPA-3 / HPA-4 (정말 0 pod)

**UX:**
- E2E 테스트
- 실시간 UI 업데이트 (WebSocket / SSE)
- discoverable repo → projects yaml 자동 PR
- Secret value 표시 (audit 모드)

**플랫폼:**
- multi-user / RBAC
- mall CF 마이그 (VPC Origins로 통일)
- EKS cluster rename (recreate)
- 백업/스냅샷 정책 정교화
- CloudWatch → ClickHouse 장기 로그

### 7.5 의존성 및 외부 가정

이 가정이 깨지면 설계 재검토 필요:
- AWS EKS가 ap-northeast-2에서 정상 운영
- CloudFront VPC Origins 기능 유지
- GitHub App / PAT API 변경 없음
- multi-region-architecture repo 접근 권한 유지
- friend 계정 admin 협조 유지

---

## Appendix

### A. Glossary

| 용어 | 의미 |
|---|---|
| **Hub cluster** | `mall-apne2-mgmt` EKS 클러스터. 모든 시스템 컴포넌트(ArgoCD, ClickHouse, Prometheus, Grafana, Atlantis) 호스팅. |
| **Spoke cluster** | 워크로드 클러스터. multi-region-mall의 us-east-1, us-west-2, ap-northeast-2-az-a, az-c. |
| **TGB** | TargetGroupBinding. AWS Load Balancer Controller의 CR. Terraform이 만든 TG를 k8s Service에 바인딩. |
| **VPC Origins** | CloudFront 기능. Internal ALB/NLB를 origin으로 사용 가능 (public IP 불필요). |
| **App of Apps** | ArgoCD 패턴. root Application이 하위 Application들을 자동 발견·동기화. |
| **TGB + Internal ALB + CF VPC Origin** | 본 플랫폼의 표준 노출 패턴. public IP 없이 CF 통해서만 외부 진입. |
| **Operator role / Terraformer role** | cross-account 역할 2종. 런타임 vs 인프라 변경 분리. |
| **HPA-2** | 본 플랫폼의 HPA 처리 방식. HPA min/max=1 패치 + Deployment scale=1. 진짜 0은 안 됨. |
| **Split-horizon DNS** | 같은 도메인이 public zone에서 CF로, private zone에서 Internal ALB로 resolve. |

### B. 참고 자료

- AWS CloudFront VPC Origins: https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-cloudfront-application-load-balancer-vpc-origins/
- AWS Load Balancer Controller TGB: https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/targetgroupbinding/targetgroupbinding/
- ArgoCD ignoreDifferences: https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/
- Atlantis 공식: https://www.runatlantis.io/
- AWS HPAScaleToZero (alpha): https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#scaling-to-zero
- AWS Cognito User Pool: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html
- release-please: https://github.com/googleapis/release-please

### C. 결정 요약 (Brainstorming 과정)

| # | 항목 | 결정 |
|---|---|---|
| 1 | UI 레이아웃 | Master-detail (사이드바 + 상세 패널) |
| 2 | 프로젝트 목록 소스 | Hybrid (GitHub auto-discovery + UI 메타데이터) |
| 3 | On/off 전략 (compute) | A: lightweight off (stop/desiredCount=0/scale=0) |
| 4 | On/off 전략 (unstoppable DBs) | A1: always-on, 가시성만 |
| 5 | Migration mode | X: code-only migration of mgmt cluster |
| 6 | ArgoCD App layout | Hybrid: system in hub, tenants App-of-Apps |
| 7 | Multi-account auth | ECS Task Role → cross-account assume-role + ExternalId |
| 8 | 사용자 모델 | Single admin (atomoh) |
| 9 | 스토리지 | Hybrid: yaml (정적) + DynamoDB (동적) |
| 10 | Tech stack | Next.js + Node.js TypeScript |
| 11 | 배포 | ECS Fargate, frontend/backend 분리 |
| 12 | LB 패턴 | CloudFront VPC Origins + Internal ALB + TGB |
| 13 | SG | CF VPC Origin SG + 10.0.0.0/8 |
| 14 | DNS | Split-horizon (public + private zones) |
| 15 | 관리자 인증 | Cognito (User Pool, 단독 사용자) |
| 16 | Atlantis GitHub | GitHub App |
| 17 | Terraform role 분리 | Operator + Terraformer (2 roles per account) |
| 18 | HPA 처리 | HPA-2: min/max=1 패치 |
| 19 | ArgoCD ignore | argocd-cm cluster-wide ignoreDifferences |
| 20 | Migration 접근 | Destructive cutover |
| 21 | shared/ 위치 | multi-region-architecture 잔류 |
| 22 | argocd 디렉토리 | `argocd-korea/`만 이전 |
| 23 | 기존 mall CF | 유지 (별도 마이그 추후) |
| 24 | Secrets 패턴 | ExternalSecrets (bootstrap은 수동) |
| 25 | dev/prod | main → dev, semver tag → prod |
| 26 | Tag 자동화 | release-please |
| 27 | 첫 prod 시점 | v1.0.0 시점에 신규 |
| 28 | Observability | logs/traces → ClickHouse, metrics → Prometheus, Tempo 제거 |
| 29 | 공유 agents | multi-region-arch 잔류, hub + spokes 모두 배포 |
| 30 | 비프로덕션 환경 | [[non-production-tolerance]] 전 영역 적용 |
