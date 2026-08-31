# infra/ Module

## Role
Terraform code for AWS Demo Platform. Hub EKS cluster reference, Atlantis IAM, network (Internal ALB, CF VPC Origin, R53 PHZ), and (planned) admin auth + dashboard runtime.

## Key Directories
- `eks-mgmt/` — **Authoritative** Terraform for the hub EKS cluster (`mall-apne2-mgmt`) + CI runner IAM (`claude-runner` Pod Identity). State key `production/ap-northeast-2/eks-mgmt/terraform.tfstate` in the shared bucket. The `eks-az-a`/`eks-az-c` spokes in `multi-region-architecture` read this state read-only via `terraform_remote_state`, so the key needs to stay stable for their plan/apply to keep resolving it. Applied via this repo's Atlantis only (the duplicate dir in `multi-region-architecture` was removed 2026-06-24).
- `atlantis-bootstrap/` — `AtlantisIRSARole` + scoped IAM policy + 4 Secrets Manager slots for GitHub App credentials.
- `alb-internal/` — Internal ALB `demo-platform-internal` and its SG. SG ingress is scoped to the CF VPC Origin source SG plus `10.0.0.0/8`.
- `cloudfront/` — CloudFront distribution + VPC Origin. Origin DomainName matches `*.atomai.click` wildcard cert to avoid SNI mismatch on https-only.
- `route53-private-zone/` — Split-horizon DNS private hosted zone for `atomai.click`.
- `cognito/`, `dashboard-ecs/`, `dynamodb/` — Stage 3 (dashboard), scaffold only.
- `iam/`, `global/` — Shared/account-global resources.
- `modules/` — Reusable submodules (copied from `multi-region-architecture`).

## Rules
- **Terraform 1.9.6** is the pinned version (Atlantis `terraform_version` across all `atlantis.yaml` projects; v1.9.8 currently fails to download on an expired upstream HashiCorp GPG key). The locking mechanism for this version is the `dynamodb_table = "multi-region-mall-terraform-locks"` setting — `use_lockfile` belongs to TF 1.10+ and isn't available here.
- **Shared backend** — bucket `multi-region-mall-terraform-state`. Each module uses a unique `key` (e.g., `aws-demo-platform/alb-internal.tfstate`).
- **ACM cert** — the wildcard cert for `*.atomai.click` is looked up via `data "aws_acm_certificate"` so every module reuses the same pre-existing cert instead of issuing a new one.
- **LB exposure** — every LB SG is scoped to the CF VPC Origin source SG plus `10.0.0.0/8`, which keeps CloudFront as the only public entry point and load balancers off the open internet.
- **CF Origin DomainName** — for SNI to work correctly on https-only, the origin domain name needs to be a subdomain already covered by the `*.atomai.click` wildcard cert (e.g., `atlantis.atomai.click`) rather than the raw AWS DNS name.
- **IAM cross-account trust** — each trust policy enforces `ExternalId` (sourced from Secrets Manager `/demo-platform/external-ids/<account>/<role>`), which is what keeps the cross-account role from being assumable by anyone who merely guesses the role ARN.
- **Module hygiene** — every module dir gets its own `CLAUDE.md` describing inputs/outputs/state key.

## Atlantis-driven changes
Submit a PR, then trigger Terraform through PR comments: commenting `atlantis plan -d infra/<module>` runs the plan for that module, and `atlantis apply -d infra/<module>` applies it once the plan looks right.
