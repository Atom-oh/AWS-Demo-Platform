# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Retired the bilingual English/Korean documentation convention — ADRs, README, CHANGELOG, runbooks, and code comments are now English-only. `AskUserQuestion` prompts to the user remain the one exception.
- Rewrote all `CLAUDE.md` files (root + module-level) and `AGENTS.md` from imperative rule lists into goal-oriented prose, with no fenced code blocks.

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
