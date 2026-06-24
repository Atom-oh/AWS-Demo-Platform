# infra/ Module

## Role
Terraform code for AWS Demo Platform. Hub EKS cluster reference, Atlantis IAM, network (Internal ALB, CF VPC Origin, R53 PHZ), and (planned) admin auth + dashboard runtime.

## Key Directories
- `eks-mgmt/` — **Authoritative** Terraform for the hub EKS cluster (`mall-apne2-mgmt`) + CI runner IAM (`claude-runner` Pod Identity). State key `production/ap-northeast-2/eks-mgmt/terraform.tfstate` in the shared bucket. The `eks-az-a`/`eks-az-c` spokes in `multi-region-architecture` read this state read-only via `terraform_remote_state` — **do not rename the key**. Applied via this repo's Atlantis only (the duplicate dir in `multi-region-architecture` was removed 2026-06-24).
- `atlantis-bootstrap/` — `AtlantisIRSARole` + scoped IAM policy + 4 Secrets Manager slots for GitHub App credentials.
- `alb-internal/` — Internal ALB `demo-platform-internal` and its SG. SG ingress must include CF VPC Origin source SG + `10.0.0.0/8`.
- `cloudfront/` — CloudFront distribution + VPC Origin. Origin DomainName matches `*.atomai.click` wildcard cert to avoid SNI mismatch on https-only.
- `route53-private-zone/` — Split-horizon DNS private hosted zone for `atomai.click`.
- `cognito/`, `dashboard-ecs/`, `dynamodb/` — Stage 3 (dashboard), scaffold only.
- `iam/`, `global/` — Shared/account-global resources.
- `modules/` — Reusable submodules (copied from `multi-region-architecture`).

## Rules
- **Terraform 1.9.8** — do NOT use `use_lockfile` (TF 1.10+). Use `dynamodb_table = "multi-region-mall-terraform-locks"`.
- **Shared backend** — bucket `multi-region-mall-terraform-state`. Each module uses a unique `key` (e.g., `aws-demo-platform/alb-internal.tfstate`).
- **ACM cert** — always `data "aws_acm_certificate"` for `*.atomai.click`. Never create a new cert.
- **No public LBs** — every LB SG is restricted to CF VPC Origin source SG + `10.0.0.0/8`.
- **CF Origin DomainName** — must be a subdomain on the `*.atomai.click` wildcard cert (e.g., `atlantis.atomai.click`), not the raw AWS DNS name, to satisfy SNI on https-only.
- **IAM cross-account trust** — must enforce `ExternalId` (sourced from Secrets Manager `/demo-platform/external-ids/<account>/<role>`).
- **Module hygiene** — every module dir gets its own `CLAUDE.md` describing inputs/outputs/state key.

## Atlantis-driven changes
Submit PR. In the PR comment:
```
atlantis plan -d infra/<module>
atlantis apply -d infra/<module>
```
