# AWS Demo Platform

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.1-green.svg)]()
<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

Admin platform for managing GitHub-linked AWS demo projects across multiple AWS accounts. | 다중 AWS 계정에 걸쳐 GitHub 연동 AWS 데모 프로젝트를 관리하는 관리자 플랫폼입니다.

---

<a id="english"></a>

# English

## Overview

AWS Demo Platform unifies operation of multiple AWS demo projects under a single admin surface. A hub EKS cluster runs Atlantis (PR-based Terraform automation), ArgoCD (GitOps for spoke workloads), and the future admin dashboard. Operators can discover projects from GitHub, toggle AWS resources on/off, surface demo URLs and code-server URLs, and manage Secrets Manager entries — all through a CloudFront-fronted control plane.

Stage 1 (infrastructure migration) is complete; the dashboard (Stage 3) is scaffolded.

See `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md` for the full design and `docs/architecture.md` for the deployed topology.

## Features

- **Hub-spoke control plane** — One EKS hub (`mall-apne2-mgmt`) manages multiple spoke clusters across AZs and (soon) accounts.
- **PR-driven Terraform** — Atlantis runs `plan` and `apply` from PR comments using IRSA + cross-account assume-role.
- **App-of-Apps GitOps** — Two ArgoCD master roots watch `argocd-apps/system/` (control plane) and `argocd-apps/tenants/` (project workloads). New project = one YAML file.
- **CloudFront-only ingress** — Internal ALB behind CF VPC Origin. No public LBs, no Kubernetes Ingress.
- **Multi-account by design** — Cross-account assume-role with ExternalId, configured via `accounts.yaml`.

## Prerequisites

- AWS CLI v2 configured for the `atomoh-main` account
- Terraform 1.9.8 (NOT 1.10+; backend uses `dynamodb_table` not `use_lockfile`)
- kubectl with hub + spoke contexts
- ArgoCD CLI
- GitHub access to `Atom-oh/AWS-Demo-Platform` and `Atom-oh/multi-region-architecture`
- Read access to `/demo-platform/*` in AWS Secrets Manager

## Installation

```bash
# Clone the repository
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform

# Run setup
bash scripts/setup.sh

# Initialize Terraform for a module
cd infra/<module>
terraform init
```

## Usage

```bash
# Terraform (preferred path: through Atlantis PR comments)
#   atlantis plan -d infra/<module>
#   atlantis apply -d infra/<module>

# ArgoCD CLI
argocd login argocd.atomai.click
argocd app list
argocd app sync <name>

# Validate K8s manifests locally
kubectl kustomize k8s/system/atlantis | kubectl apply --dry-run=client -f -

# Run harness tests
bash tests/run-all.sh
```

## Project Structure

| Path | Purpose |
|---|---|
| `accounts.yaml` | Target AWS accounts (cross-account assume-role config) |
| `projects/*.yaml` | Per-project metadata (resources, URLs, on/off targets) |
| `infra/` | Terraform — hub cluster, network, IAM, dashboard infra |
| `k8s/system/` | Kustomize manifests for hub cluster system components |
| `argocd-apps/system/` | ArgoCD Application CRs for system components |
| `argocd-apps/tenants/` | ArgoCD root Application CRs per tenant project (App-of-Apps) |
| `argocd-apps/bootstrap/` | Master-root Applications (one-time bootstrap) |
| `dashboard/` | Stage 3 admin UI + API (Next.js + Node.js TS, scaffold) |
| `docs/superpowers/` | Specs, plans, retrospectives |
| `docs/onboarding/` | Friend account onboarding guides |
| `docs/decisions/` | ADRs |
| `docs/runbooks/` | Operational runbooks |
| `scripts/` | Setup, hook installer |
| `tests/` | Harness validation suite |
| `.claude/` | Claude Code settings, hooks, skills, commands, agents |

## Operating Model

- Non-production environment. Brief outages OK.
- Two environments: `main` branch → dev; semver tag → prod.
- Terraform changes go through Atlantis (PR `atlantis plan` / `atlantis apply`).
- K8s changes go through ArgoCD (auto-sync on hub).

## Testing

```bash
# Harness tests (hook scripts, secret patterns, structure invariants)
bash tests/run-all.sh

# Terraform validate (per module)
cd infra/<module> && terraform fmt -check && terraform validate

# Kustomize build (per overlay)
kubectl kustomize k8s/system/<overlay>
```

## Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request — Atlantis will comment back with `plan` output for `infra/**` changes

## License

MIT — see [LICENSE](LICENSE) when added.

## Contact

- Maintainer: [Atom-oh](https://github.com/Atom-oh)
- Issues: [GitHub Issues](https://github.com/Atom-oh/AWS-Demo-Platform/issues)

---

<a id="korean"></a>

# 한국어

## 개요

AWS Demo Platform은 여러 AWS 데모 프로젝트의 운영을 단일 관리자 화면으로 통합합니다. Hub EKS 클러스터에서 Atlantis(PR 기반 Terraform 자동화), ArgoCD(spoke 워크로드 GitOps), 그리고 향후 관리자 대시보드를 실행합니다. 운영자는 GitHub에서 프로젝트를 발견하고, AWS 리소스를 on/off 하고, 데모 URL 및 code-server URL을 노출하고, Secrets Manager 항목을 관리할 수 있으며, 모든 통신은 CloudFront 앞단의 제어 평면을 통해 이루어집니다.

1단계(인프라 마이그레이션)는 완료되었고, 대시보드(3단계)는 스캐폴드 상태입니다.

전체 설계는 `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`, 배포된 토폴로지는 `docs/architecture.md`를 참조하세요.

## 주요 기능

- **Hub-spoke 제어 평면** — 단일 EKS hub(`mall-apne2-mgmt`)가 여러 AZ(그리고 곧 여러 계정)의 spoke 클러스터를 관리합니다.
- **PR 기반 Terraform** — Atlantis가 IRSA + cross-account assume-role을 사용해 PR 댓글에서 `plan`/`apply`를 실행합니다.
- **App-of-Apps GitOps** — 두 개의 ArgoCD master root가 `argocd-apps/system/`(제어 평면)과 `argocd-apps/tenants/`(프로젝트 워크로드)를 watch합니다. 새 프로젝트 추가는 YAML 한 개를 추가하면 됩니다.
- **CloudFront-only ingress** — CF VPC Origin 뒤에 Internal ALB. Public LB 없음, K8s Ingress 없음.
- **다중 계정 설계** — ExternalId를 사용한 cross-account assume-role을 `accounts.yaml`로 구성합니다.

## 사전 요구 사항

- `atomoh-main` 계정으로 구성된 AWS CLI v2
- Terraform 1.9.8 (1.10+는 NOT; 백엔드가 `use_lockfile`이 아닌 `dynamodb_table`을 사용함)
- hub와 spoke 컨텍스트를 가진 kubectl
- ArgoCD CLI
- `Atom-oh/AWS-Demo-Platform`과 `Atom-oh/multi-region-architecture` GitHub 접근권
- AWS Secrets Manager `/demo-platform/*` 읽기 권한

## 설치 방법

```bash
# 저장소 클론
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform

# 셋업 실행
bash scripts/setup.sh

# 특정 모듈에 대해 Terraform 초기화
cd infra/<module>
terraform init
```

## 사용법

```bash
# Terraform (권장 경로: Atlantis PR 댓글)
#   atlantis plan -d infra/<module>
#   atlantis apply -d infra/<module>

# ArgoCD CLI
argocd login argocd.atomai.click
argocd app list
argocd app sync <name>

# 로컬에서 K8s 매니페스트 검증
kubectl kustomize k8s/system/atlantis | kubectl apply --dry-run=client -f -

# Harness 테스트 실행
bash tests/run-all.sh
```

## 프로젝트 구조

| 경로 | 용도 |
|------|------|
| `accounts.yaml` | 대상 AWS 계정 (cross-account assume-role 구성) |
| `projects/*.yaml` | 프로젝트별 메타데이터 (리소스, URL, on/off 대상) |
| `infra/` | Terraform — hub 클러스터, 네트워크, IAM, dashboard 인프라 |
| `k8s/system/` | hub 클러스터 시스템 컴포넌트용 Kustomize 매니페스트 |
| `argocd-apps/system/` | 시스템 컴포넌트용 ArgoCD Application CR |
| `argocd-apps/tenants/` | tenant 프로젝트별 ArgoCD root Application CR (App-of-Apps) |
| `argocd-apps/bootstrap/` | Master-root Application (1회 부트스트랩) |
| `dashboard/` | 3단계 관리자 UI + API (Next.js + Node.js TS, 스캐폴드) |
| `docs/superpowers/` | 스펙, 계획, 회고 |
| `docs/onboarding/` | 친구 계정 onboarding 가이드 |
| `docs/decisions/` | ADR |
| `docs/runbooks/` | 운영 runbook |
| `scripts/` | 셋업, hook 설치 |
| `tests/` | Harness 검증 suite |
| `.claude/` | Claude Code 설정, hook, skill, command, agent |

## 운영 모델

- 비프로덕션 환경. 짧은 장애 허용.
- 두 환경: `main` 브랜치 → dev; semver 태그 → prod.
- Terraform 변경은 Atlantis(PR `atlantis plan` / `atlantis apply`)를 통합니다.
- K8s 변경은 ArgoCD(hub 자동 sync)를 통합니다.

## 테스트

```bash
# Harness 테스트 (hook 스크립트, secret 패턴, 구조 invariant)
bash tests/run-all.sh

# Terraform 검증 (모듈별)
cd infra/<module> && terraform fmt -check && terraform validate

# Kustomize 빌드 (overlay별)
kubectl kustomize k8s/system/<overlay>
```

## 기여 방법

1. 저장소를 fork합니다
2. 브랜치를 만듭니다 (`git checkout -b feat/amazing-feature`)
3. 변경 사항을 커밋합니다 (`git commit -m 'feat: add amazing feature'`)
4. 브랜치를 push합니다 (`git push origin feat/amazing-feature`)
5. Pull Request를 엽니다 — Atlantis가 `infra/**` 변경에 대해 `plan` 출력을 댓글로 남깁니다

## 라이선스

MIT — 추가될 [LICENSE](LICENSE) 파일을 참조하세요.

## 연락처

- 메인테이너: [Atom-oh](https://github.com/Atom-oh)
- 이슈: [GitHub Issues](https://github.com/Atom-oh/AWS-Demo-Platform/issues)
