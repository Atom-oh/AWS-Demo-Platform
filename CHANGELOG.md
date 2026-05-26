# Changelog

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-05-26

### Added
- Register Atlantis, ArgoCD (self-managed), External Secrets Operator, and ClusterSecretStore as system Applications under `argocd-apps/system/`
- Stage 1 retrospective update covering all post-v0.1.0 work (permission verification, live cluster cleanup, upstream manifest dedup, system Applications registration)
- `Replace=true` sync option on tenant Applications to bypass structured-merge diff on legacy resources

### Fixed
- Bypass SharedResourceWarning(105) on workload sync when ServerSideApply alone was insufficient

## [0.1.0] - 2026-05-26

### Added
- Repository skeleton, `.gitignore`, README, design spec, and Stage 1 implementation plan
- Terraform modules migrated from `multi-region-architecture` (compute/eks, alb, observability)
- `infra/eks-mgmt` cross-repo Terraform with shared `multi-region-mall-terraform-state` backend
- `infra/atlantis-bootstrap`: `AtlantisIRSARole` + scoped IAM policy + 4 Secrets Manager slots for GitHub App credentials
- Atlantis on hub via Kustomize (`k8s/system/atlantis`), with `--write-git-creds` flag and ExternalSecret `v1`
- External Secrets Operator 2.5.0 bootstrap (helm + IRSA + `ClusterSecretStore aws-secrets-manager`)
- `infra/alb-internal`: Internal ALB `demo-platform-internal` with SG ingress for CF VPC Origin source SG + `10.0.0.0/8`
- `infra/cloudfront`: CloudFront distribution + VPC Origin (https-only) using existing `*.atomai.click` wildcard ACM cert
- `infra/route53-private-zone`: split-horizon private hosted zone for `atomai.click`
- ArgoCD v3.4.2 via Helm chart `argo/argo-cd` 9.5.15 with cluster-wide HPA-2 `ignoreDifferences` baked into `argocd-cm`
- App-of-Apps roots: `master-system-root` and `master-tenants-root` (in `argocd-apps/bootstrap/`)
- Tenant Applications for `multi-region-mall` ap-northeast-2 spokes (`workloads-apne2-az-{a,c}`)
- `accounts.yaml` and `projects/multi-region-mall.yaml` initial entries
- `docs/onboarding/friend-account-setup.md` for adding new AWS accounts

### Changed
- CF Origin DomainName set to `atlantis.atomai.click` (matches wildcard cert) instead of raw ALB AWS DNS to avoid SNI mismatch on https-only
- Helm install adoption: existing cluster-scoped resources adopted via Helm ownership labels/annotations

### Fixed
- TF 1.9.8 compatibility: substituted `use_lockfile = true` (TF 1.10+) with `dynamodb_table = "multi-region-mall-terraform-locks"`
- Hub node taint tolerations added to ESO, Atlantis, and ArgoCD Helm values
- CF VPC Origin connectivity to ALB: required explicit `security_groups = [cf_vpc_origin_sg_id]` ingress rule on the ALB SG

[Unreleased]: https://github.com/Atom-oh/AWS-Demo-Platform/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Atom-oh/AWS-Demo-Platform/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Atom-oh/AWS-Demo-Platform/releases/tag/v0.1.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

## [0.1.1] - 2026-05-26

### Added
- `argocd-apps/system/` 하위에 Atlantis, ArgoCD(자가 관리), External Secrets Operator, ClusterSecretStore를 system Application으로 등록
- v0.1.0 이후의 모든 작업(권한 검증, 라이브 클러스터 정리, 상위 매니페스트 중복 제거, system Application 등록)을 다룬 Stage 1 회고 업데이트
- 레거시 리소스의 structured-merge diff를 우회하기 위해 tenant Application에 `Replace=true` sync 옵션 추가

### Fixed
- ServerSideApply만으로는 부족했던 워크로드 sync의 SharedResourceWarning(105) 우회

## [0.1.0] - 2026-05-26

### Added
- 저장소 스켈레톤, `.gitignore`, README, 설계 스펙, Stage 1 구현 계획
- `multi-region-architecture`에서 Terraform 모듈(compute/eks, alb, observability) 마이그레이션
- 공유 백엔드 `multi-region-mall-terraform-state`를 사용하는 cross-repo Terraform `infra/eks-mgmt`
- `infra/atlantis-bootstrap`: `AtlantisIRSARole` + 범위 제한 IAM 정책 + GitHub App 자격증명용 Secrets Manager 슬롯 4개
- `--write-git-creds` 플래그와 `v1` ExternalSecret을 사용한 Kustomize 기반(`k8s/system/atlantis`) hub Atlantis
- External Secrets Operator 2.5.0 부트스트랩 (helm + IRSA + `ClusterSecretStore aws-secrets-manager`)
- CF VPC Origin source SG + `10.0.0.0/8` ingress를 가진 `infra/alb-internal`: Internal ALB `demo-platform-internal`
- 기존 `*.atomai.click` 와일드카드 ACM 인증서를 사용하는 `infra/cloudfront`: CloudFront 배포 + VPC Origin(https-only)
- `infra/route53-private-zone`: `atomai.click` split-horizon private hosted zone
- 클러스터 전역 HPA-2 `ignoreDifferences`가 `argocd-cm`에 내장된, Helm 차트 `argo/argo-cd` 9.5.15 기반 ArgoCD v3.4.2
- App-of-Apps root: `master-system-root` 및 `master-tenants-root` (`argocd-apps/bootstrap/`)
- `multi-region-mall` ap-northeast-2 spoke용 tenant Application (`workloads-apne2-az-{a,c}`)
- `accounts.yaml` 및 `projects/multi-region-mall.yaml` 초기 항목
- 새 AWS 계정 추가를 위한 `docs/onboarding/friend-account-setup.md`

### Changed
- https-only에서의 SNI mismatch 회피를 위해 CF Origin DomainName을 raw ALB AWS DNS 대신 `atlantis.atomai.click`(와일드카드 인증서 매칭)으로 변경
- Helm install adoption: 기존 cluster-scoped 리소스를 Helm ownership 레이블/어노테이션으로 채택

### Fixed
- TF 1.9.8 호환: `use_lockfile = true` (TF 1.10+) 대신 `dynamodb_table = "multi-region-mall-terraform-locks"`로 대체
- ESO, Atlantis, ArgoCD Helm 값에 hub 노드 taint toleration 추가
- CF VPC Origin과 ALB 연결: ALB SG에 `security_groups = [cf_vpc_origin_sg_id]` ingress 규칙을 명시적으로 추가

[Unreleased]: https://github.com/Atom-oh/AWS-Demo-Platform/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Atom-oh/AWS-Demo-Platform/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Atom-oh/AWS-Demo-Platform/releases/tag/v0.1.0
