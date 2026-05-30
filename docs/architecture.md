# Architecture

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## System Overview

AWS Demo Platform is a hub-spoke control plane for managing GitHub-linked AWS demo projects across multiple AWS accounts. A single management EKS cluster (`mall-apne2-mgmt`) hosts Atlantis (PR-based Terraform automation), ArgoCD (GitOps for spoke workloads), and the external admin dashboard (planned Stage 3, ECS Fargate). All ingress flows through CloudFront → VPC Origin → Internal ALB → TargetGroupBinding, with no Kubernetes Ingress controllers and no public load balancers.

## Components

### Ingestion Layer
- **CloudFront** — Sole public entry point. Distributions for `atlantis.atomai.click`, `argocd.atomai.click`, and (planned) the dashboard. Origin protocol https-only; uses the `*.atomai.click` wildcard ACM cert.
- **CloudFront VPC Origin** — Private origin reaching the Internal ALB inside the VPC. The CF VPC Origin source SG (`sg-0a67fc7bfa9c2f0c6`) is added to the ALB SG ingress rule.
- **Internal ALB (`demo-platform-internal`)** — HTTPS:443 listener. Host-header rules route to per-component target groups (Atlantis, ArgoCD, future dashboard).

### Processing / Control Layer
- **EKS hub (`mall-apne2-mgmt`)** — Hosts Atlantis, ArgoCD v3.4.2, External Secrets Operator, and (in later stages) clickhouse-mgmt, prometheus, grafana, github self-hosted runners.
- **Atlantis** — Deployed via Kustomize (`k8s/system/atlantis`). IRSA → `AtlantisIRSARole` → cross-account assume of `DemoPlatformTerraformer`. GitHub App `atomoh-atlantis` webhook. `--write-git-creds` flag required.
- **ArgoCD** — Helm chart `argo/argo-cd` 9.5.15, self-managed. App-of-Apps: `master-system-root` watches `argocd-apps/system/`, `master-tenants-root` watches `argocd-apps/tenants/`. Spoke clusters registered via `argocd cluster add --upsert`.
- **External Secrets Operator (ESO)** — `ClusterSecretStore aws-secrets-manager` (v1 API). IRSA on hub via `ExternalSecretsIRSARole`. Provides `ExternalSecret` resources for Atlantis, ArgoCD admin, GitHub App, and future dashboard secrets.

### Storage Layer
- **AWS Secrets Manager** — All runtime secrets under `/demo-platform/...`. GitHub App credentials (4 slots), ArgoCD admin password, cross-account ExternalIds.
- **Terraform state** — Shared S3 backend `multi-region-mall-terraform-state` (cross-repo with `multi-region-architecture`), DynamoDB lock table `multi-region-mall-terraform-locks`.
- **(Stage 3)** DynamoDB for dashboard project metadata + cache.

### Presentation Layer
- **Atlantis UI** — `https://atlantis.atomai.click` (PR triage, plan/apply outputs).
- **ArgoCD UI** — `https://argocd.atomai.click` (8 Applications: 2 master roots, 4 system, 2 tenant).
- **(Stage 3) Dashboard** — Next.js frontend + Node.js TS backend on ECS Fargate. Cognito for admin auth.

### Security Layer
- **IAM cross-account** — `OperatorRole` (read) and `DemoPlatformTerraformer` (write) per target account. Trust policy enforces ExternalId fetched from Secrets Manager.
- **Network isolation** — All LBs accept only CF VPC Origin source SG + `10.0.0.0/8`. No public LBs. No K8s Ingress.
- **Route 53 split-horizon** — Public hosted zone for CF; private hosted zone for internal name resolution.

## Full Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Public Internet                             │
│  Operator / Admin / Friend Accounts                               │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTPS (atomai.click)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                       CloudFront                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │atlantis.     │  │argocd.       │  │(planned) dashboard.  │    │
│  │atomai.click  │  │atomai.click  │  │atomai.click          │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘    │
└─────────┼─────────────────┼─────────────────────┼────────────────┘
          ▼                 ▼                     ▼
        CloudFront VPC Origin (sg-0a67fc7bfa9c2f0c6)
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                Internal ALB demo-platform-internal                │
│  Host header rules → Target Groups                                │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │Atlantis TG  │  │ArgoCD TG    │  │Dashboard TG  │               │
│  │(port 4141)  │  │(port 8080)  │  │(planned)     │               │
│  └──────┬──────┘  └──────┬──────┘  └──────────────┘               │
└─────────┼────────────────┼─────────────────────────────────────────┘
          │ TGB            │ TGB
          ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   EKS hub: mall-apne2-mgmt                         │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │Atlantis Pod    │  │ArgoCD          │  │ESO + CSS         │    │
│  │  IRSA:         │  │  hub control   │  │  IRSA:           │    │
│  │  AtlantisIRSA  │  │  plane         │  │  ExtSecretsIRSA  │    │
│  │  Role          │  │                │  │                  │    │
│  └────────┬───────┘  └────────┬───────┘  └────────┬─────────┘    │
└───────────┼───────────────────┼───────────────────┼──────────────┘
            │ AssumeRole         │ ArgoCD spoke      │ Reads
            │ (ExternalId)       │ connections       │ Secrets Mgr
            ▼                    ▼                   ▼
┌─────────────────────┐  ┌───────────────────┐  ┌─────────────────┐
│Target AWS Accounts  │  │EKS spoke clusters │  │AWS Secrets Mgr  │
│  atomoh-main        │  │  mall-apne2-az-a  │  │/demo-platform/* │
│  (+ friends planned)│  │  mall-apne2-az-c  │  │                 │
│DemoPlatformTerraformer│  │workloads:        │  │                 │
│OperatorRole         │  │cart, inventory,   │  │                 │
│                     │  │order, ...         │  │                 │
└─────────────────────┘  └───────────────────┘  └─────────────────┘
```

## Data Flow Summary

```
Browser -> CloudFront -> VPC Origin -> Internal ALB -> TGB -> Pod (Atlantis | ArgoCD | Dashboard)
                                                                  |
                                                  ┌───────────────┼───────────────┐
                                                  ▼               ▼               ▼
                                          GitHub webhook    Spoke EKS API   Secrets Manager
                                                |                 |                 |
                                                ▼                 ▼                 ▼
                                          atlantis plan/apply  argocd sync     ESO -> K8s Secret
                                                |
                                                ▼
                                          AssumeRole -> Target AWS Account -> Terraform apply
```

## Infrastructure

### Deployment Region
- `ap-northeast-2` (Seoul) — only region for Stage 1. The hub cluster lives here; spokes are AZ-pinned within this region.

### Terraform Modules (current)
| Module | Purpose |
|--------|---------|
| `infra/eks-mgmt` | Hub cluster cross-repo state reference |
| `infra/atlantis-bootstrap` | AtlantisIRSARole + Secrets Manager slots for GitHub App |
| `infra/alb-internal` | Internal ALB + SG (CF + 10.0.0.0/8 ingress) |
| `infra/cloudfront` | CF distribution + VPC Origin |
| `infra/route53-private-zone` | Split-horizon PHZ for `*.atomai.click` |
| `infra/cognito` | Admin auth (planned) |
| `infra/dashboard-ecs` | Dashboard runtime (planned) |
| `infra/iam` | DashboardEcsTaskRole-dev + ExecutionRole-dev + DemoPlatformOperator (Stage 2) |
| `infra/global` | Account-global resources |
| `infra/dynamodb` | Lifecycle Controller state/jobs/history tables (Stage 2, dev) |
| `infra/sqs` | Lifecycle Controller job queue + DLQ (Stage 2, dev) |
| `infra/ecr` | `demo-platform/api` + `demo-platform/worker` image repos (Stage 2) |
| `infra/secrets-manager` | Dashboard secret slots: github PAT, argocd token, cognito (Stage 2) |
| `infra/modules` | Reusable submodules |

### Deployed Resources (Stage 1)
- Atlantis: `https://atlantis.atomai.click/`
- ArgoCD: `https://argocd.atomai.click/`
- CloudFront distributions: `ET2KPA4HLYFNF` (atlantis), `E30DX8JLNHJL7C` (argocd)
- VPC Origin: `vo_22VbzKdu79hDrHuT2h1j2B`
- Internal ALB: `demo-platform-internal`

## Key Design Decisions

- **CloudFront-only ingress** — Single public surface, single TLS/WAF anchor, no public LBs. The CF VPC Origin feature (AWS Nov 2024) enables this without NAT.
- **TargetGroupBinding over Ingress** — TGs live in Terraform state (immutable infrastructure); pods opt in via TGB CRD. Avoids the cost of running an Ingress controller and keeps networking declarative in TF.
- **HPA-2 demo on/off pattern** — Instead of patching `replicas=0` (which alpha `HPAScaleToZero` would require), patch HPA `min=max=1`. Cluster-wide `argocd-cm.ignoreDifferences` covers Deployment/StatefulSet `/spec/replicas` and HPA `/spec/minReplicas`+`/spec/maxReplicas` so ArgoCD doesn't fight the patch.
- **App-of-Apps with two master roots** — `master-system-root` (`argocd-apps/system/`) for control-plane components and `master-tenants-root` (`argocd-apps/tenants/`) for per-project roots. Adding a new project = dropping a YAML in `argocd-apps/tenants/`.
- **Atlantis on hub via IRSA + cross-account** — No long-lived IAM users. Atlantis pod IRSA → `AtlantisIRSARole` → assumes `DemoPlatformTerraformer` in each target account using ExternalId from Secrets Manager.
- **Wildcard ACM cert reuse** — Use the existing `*.atomai.click` cert via `data` lookup instead of issuing per-subdomain certs. CF Origin DomainName matches the cert SAN to avoid SNI mismatch over HTTPS-only.
- **Helm + Kustomize hybrid** — Helm for upstream third-party charts (ArgoCD, ESO). Kustomize for repo-owned manifests (Atlantis). Avoids forking charts while keeping our own manifests transparent.
- **TF backend shared with multi-region-architecture** — Single S3 bucket + DDB lock table across both repos. TF 1.9.8 → `dynamodb_table` instead of TF 1.10+ `use_lockfile`.

## Operations
- Deployment: see [docs/runbooks/.template.md](runbooks/.template.md) (concrete runbooks pending)
- Friend account onboarding: see [docs/onboarding/friend-account-setup.md](onboarding/friend-account-setup.md)
- Stage 1 retrospective: [docs/superpowers/retrospectives/2026-05-26-stage-1.md](superpowers/retrospectives/2026-05-26-stage-1.md)

---

<a id="korean"></a>

# 한국어

## 시스템 개요

AWS Demo Platform은 GitHub 연동 AWS 데모 프로젝트를 다중 AWS 계정에 걸쳐 관리하는 hub-spoke 제어 평면입니다. 단일 관리 EKS 클러스터(`mall-apne2-mgmt`)가 Atlantis(PR 기반 Terraform 자동화), ArgoCD(spoke 워크로드 GitOps), 외부 관리자 대시보드(3단계 예정, ECS Fargate)를 호스팅합니다. 모든 ingress는 CloudFront → VPC Origin → Internal ALB → TargetGroupBinding 경로를 따르며, Kubernetes Ingress 컨트롤러나 public 로드밸런서는 사용하지 않습니다.

## 구성 요소

### Ingestion Layer
- **CloudFront** — 유일한 공개 진입점. `atlantis.atomai.click`, `argocd.atomai.click`, (예정) 대시보드용 배포가 있으며, origin protocol은 https-only이고 `*.atomai.click` 와일드카드 ACM 인증서를 사용합니다.
- **CloudFront VPC Origin** — VPC 내부 Internal ALB에 도달하는 private origin. CF VPC Origin source SG(`sg-0a67fc7bfa9c2f0c6`)는 ALB SG ingress 규칙에 추가되어 있습니다.
- **Internal ALB (`demo-platform-internal`)** — HTTPS:443 리스너. Host header 규칙으로 컴포넌트별 Target Group(Atlantis, ArgoCD, 향후 dashboard)으로 라우팅합니다.

### Processing / Control Layer
- **EKS hub (`mall-apne2-mgmt`)** — Atlantis, ArgoCD v3.4.2, External Secrets Operator를 호스팅하며 이후 단계에서 clickhouse-mgmt, prometheus, grafana, github self-hosted runner를 호스팅합니다.
- **Atlantis** — Kustomize(`k8s/system/atlantis`)로 배포. IRSA → `AtlantisIRSARole` → 타겟 계정 `DemoPlatformTerraformer` cross-account AssumeRole. GitHub App `atomoh-atlantis` webhook을 사용하며 `--write-git-creds` 플래그가 필수입니다.
- **ArgoCD** — Helm 차트 `argo/argo-cd` 9.5.15, 자기 자신을 관리합니다. App-of-Apps 패턴: `master-system-root`는 `argocd-apps/system/`을, `master-tenants-root`는 `argocd-apps/tenants/`를 watch합니다. Spoke 클러스터는 `argocd cluster add --upsert`로 등록되어 있습니다.
- **External Secrets Operator (ESO)** — `ClusterSecretStore aws-secrets-manager`(v1 API). hub에서 `ExternalSecretsIRSARole` IRSA를 사용합니다. Atlantis, ArgoCD 관리자, GitHub App, 향후 dashboard 시크릿용 `ExternalSecret` 리소스를 제공합니다.

### Storage Layer
- **AWS Secrets Manager** — 모든 런타임 시크릿은 `/demo-platform/...` 경로에 저장합니다. GitHub App 자격 증명(4개 슬롯), ArgoCD 관리자 패스워드, 계정 간 ExternalId가 여기에 있습니다.
- **Terraform state** — 공유 S3 백엔드 `multi-region-mall-terraform-state`(`multi-region-architecture` 리포와 공유), DynamoDB lock 테이블 `multi-region-mall-terraform-locks`.
- **(3단계)** Dashboard 프로젝트 메타데이터 및 캐시를 위한 DynamoDB.

### Presentation Layer
- **Atlantis UI** — `https://atlantis.atomai.click` (PR triage, plan/apply 출력).
- **ArgoCD UI** — `https://argocd.atomai.click` (8개 Application: 2 master root, 4 system, 2 tenant).
- **(3단계) Dashboard** — ECS Fargate에 Next.js 프론트엔드 + Node.js TS 백엔드. 관리자 인증은 Cognito.

### Security Layer
- **IAM cross-account** — 타겟 계정마다 `OperatorRole`(read), `DemoPlatformTerraformer`(write). Trust 정책은 Secrets Manager에서 가져온 ExternalId를 강제합니다.
- **Network isolation** — 모든 LB는 CF VPC Origin source SG + `10.0.0.0/8`만 허용합니다. Public LB 없음. K8s Ingress 없음.
- **Route 53 split-horizon** — CF용 public hosted zone, 내부 이름 해석용 private hosted zone.

## 전체 아키텍처 다이어그램

```
┌──────────────────────────────────────────────────────────────────┐
│                       Public Internet                             │
│  Operator / Admin / Friend Accounts                               │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTPS (atomai.click)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                       CloudFront                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │atlantis.     │  │argocd.       │  │(planned) dashboard.  │    │
│  │atomai.click  │  │atomai.click  │  │atomai.click          │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘    │
└─────────┼─────────────────┼─────────────────────┼────────────────┘
          ▼                 ▼                     ▼
        CloudFront VPC Origin (sg-0a67fc7bfa9c2f0c6)
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                Internal ALB demo-platform-internal                │
│  Host header rules → Target Groups                                │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │Atlantis TG  │  │ArgoCD TG    │  │Dashboard TG  │               │
│  │(port 4141)  │  │(port 8080)  │  │(planned)     │               │
│  └──────┬──────┘  └──────┬──────┘  └──────────────┘               │
└─────────┼────────────────┼─────────────────────────────────────────┘
          │ TGB            │ TGB
          ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   EKS hub: mall-apne2-mgmt                         │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │Atlantis Pod    │  │ArgoCD          │  │ESO + CSS         │    │
│  │  IRSA:         │  │  hub control   │  │  IRSA:           │    │
│  │  AtlantisIRSA  │  │  plane         │  │  ExtSecretsIRSA  │    │
│  │  Role          │  │                │  │                  │    │
│  └────────┬───────┘  └────────┬───────┘  └────────┬─────────┘    │
└───────────┼───────────────────┼───────────────────┼──────────────┘
            │ AssumeRole         │ ArgoCD spoke      │ Reads
            │ (ExternalId)       │ connections       │ Secrets Mgr
            ▼                    ▼                   ▼
┌─────────────────────┐  ┌───────────────────┐  ┌─────────────────┐
│Target AWS Accounts  │  │EKS spoke clusters │  │AWS Secrets Mgr  │
│  atomoh-main        │  │  mall-apne2-az-a  │  │/demo-platform/* │
│  (+ friends planned)│  │  mall-apne2-az-c  │  │                 │
│DemoPlatformTerraformer│  │workloads:        │  │                 │
│OperatorRole         │  │cart, inventory,   │  │                 │
│                     │  │order, ...         │  │                 │
└─────────────────────┘  └───────────────────┘  └─────────────────┘
```

## 데이터 흐름 요약

```
Browser -> CloudFront -> VPC Origin -> Internal ALB -> TGB -> Pod (Atlantis | ArgoCD | Dashboard)
                                                                  |
                                                  ┌───────────────┼───────────────┐
                                                  ▼               ▼               ▼
                                          GitHub webhook    Spoke EKS API   Secrets Manager
                                                |                 |                 |
                                                ▼                 ▼                 ▼
                                          atlantis plan/apply  argocd sync     ESO -> K8s Secret
                                                |
                                                ▼
                                          AssumeRole -> Target AWS Account -> Terraform apply
```

## 인프라

### 배포 리전
- `ap-northeast-2` (서울) — 1단계는 단일 리전입니다. Hub 클러스터가 여기에 있고 spoke는 이 리전 내에서 AZ pinning됩니다.

### Terraform 모듈 (현재)
| 모듈 | 역할 |
|------|------|
| `infra/eks-mgmt` | Hub 클러스터 cross-repo state 참조 |
| `infra/atlantis-bootstrap` | AtlantisIRSARole + GitHub App용 Secrets Manager 슬롯 |
| `infra/alb-internal` | Internal ALB + SG (CF + 10.0.0.0/8 ingress) |
| `infra/cloudfront` | CF 배포 + VPC Origin |
| `infra/route53-private-zone` | `*.atomai.click` Split-horizon PHZ |
| `infra/cognito` | 관리자 인증 (예정) |
| `infra/dashboard-ecs` | Dashboard 런타임 (예정) |
| `infra/iam` | 공유 역할 |
| `infra/global` | 계정 단위 글로벌 리소스 |
| `infra/dynamodb` | Dashboard 상태 저장소 (예정) |
| `infra/modules` | 재사용 가능한 서브모듈 |

### 배포된 리소스 (1단계)
- Atlantis: `https://atlantis.atomai.click/`
- ArgoCD: `https://argocd.atomai.click/`
- CloudFront 배포: `ET2KPA4HLYFNF` (atlantis), `E30DX8JLNHJL7C` (argocd)
- VPC Origin: `vo_22VbzKdu79hDrHuT2h1j2B`
- Internal ALB: `demo-platform-internal`

## 주요 설계 결정

- **CloudFront-only ingress** — 단일 공개 surface, 단일 TLS/WAF 앵커, public LB 없음. CF VPC Origin 기능(AWS 2024년 11월)으로 NAT 없이 구현됩니다.
- **Ingress 대신 TargetGroupBinding** — TG는 Terraform state(불변 인프라)에서 관리하고, pod는 TGB CRD로 opt-in합니다. Ingress 컨트롤러 운영 비용을 피하고 네트워킹을 TF에서 선언적으로 유지합니다.
- **HPA-2 demo on/off 패턴** — `replicas=0` 패치 대신(alpha `HPAScaleToZero` 필요) HPA `min=max=1`을 패치합니다. 클러스터 전역 `argocd-cm.ignoreDifferences`가 Deployment/StatefulSet `/spec/replicas`와 HPA `/spec/minReplicas`+`/spec/maxReplicas`를 커버하여 ArgoCD가 패치를 되돌리지 않습니다.
- **두 개의 master root을 갖는 App-of-Apps** — 제어 평면 컴포넌트용 `master-system-root`(`argocd-apps/system/`)와 프로젝트별 root용 `master-tenants-root`(`argocd-apps/tenants/`). 새 프로젝트 추가는 `argocd-apps/tenants/`에 YAML 한 개를 drop하면 됩니다.
- **IRSA + cross-account로 hub에 Atlantis** — 장기 IAM 사용자 없음. Atlantis pod IRSA → `AtlantisIRSARole` → Secrets Manager의 ExternalId를 사용해 각 타겟 계정의 `DemoPlatformTerraformer`를 assume합니다.
- **와일드카드 ACM 인증서 재사용** — 서브도메인마다 인증서를 발급하는 대신 기존 `*.atomai.click` 인증서를 `data` lookup으로 사용합니다. HTTPS-only에서 SNI mismatch를 피하기 위해 CF Origin DomainName을 인증서 SAN과 일치시킵니다.
- **Helm + Kustomize 하이브리드** — 외부 third-party 차트(ArgoCD, ESO)는 Helm으로, 리포 소유 매니페스트(Atlantis)는 Kustomize로. 차트를 fork하지 않으면서 자체 매니페스트는 투명하게 유지합니다.
- **multi-region-architecture와 TF 백엔드 공유** — 두 리포가 단일 S3 버킷 + DDB lock 테이블을 공유합니다. TF 1.9.8에서는 TF 1.10+의 `use_lockfile` 대신 `dynamodb_table`을 사용합니다.

## 운영
- 배포: [docs/runbooks/.template.md](runbooks/.template.md) 참조 (구체적인 runbook은 작성 예정)
- 친구 계정 onboarding: [docs/onboarding/friend-account-setup.md](onboarding/friend-account-setup.md) 참조
- 1단계 회고: [docs/superpowers/retrospectives/2026-05-26-stage-1.md](superpowers/retrospectives/2026-05-26-stage-1.md)
