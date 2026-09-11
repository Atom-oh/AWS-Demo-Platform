# Infrastructure guide

This directory owns Terraform for the hub cluster, automation identity, private
routing, dashboard runtime and supporting services. Each root module has its own
state; reusable code under `modules/` is not applied independently.

## Ownership

- `eks-mgmt/` is the authoritative owner of `mall-apne2-mgmt` and shared runner
  identity. Keep `production/ap-northeast-2/eks-mgmt/terraform.tfstate` stable;
  `multi-region-architecture` no longer applies a duplicate hub module.
- `alb-internal/` owns the internal ALB, restricted SG and target groups, including
  Grafana. `cloudfront/` owns platform distributions and their shared VPC Origin.
- Grafana's CloudFront distribution/public DNS remain owned by
  `Atom-oh/multi-region-architecture` in its Korea `shared/` state. This repository
  owns the Grafana backend/binding. Coordinate both owners before a cutover.
- `dashboard-ecs/`, `cognito/`, `dynamodb/`, `sqs/`, `ecr/`, `iam/` and
  `secrets-manager/` contain implemented dashboard infrastructure, not placeholders.
- `atlantis-bootstrap/` owns Atlantis identity/policy and GitHub App secret containers;
  `route53-private-zone/` defines platform aliases and split-horizon DNS.

## Contracts

Atlantis pins Terraform 1.9.6. Use `dynamodb_table` locking, not TF 1.10+
`use_lockfile`. The shared bucket is `multi-region-mall-terraform-state`; read each
module's exact backend key rather than inventing a new one. Apply a dependency
before planning a consumer of newly introduced remote-state outputs.

Reuse the existing `*.atomai.click` ACM certificate through data sources. The
platform internal ALB HTTPS SG accepts exactly the CloudFront VPC Origin source
SG plus `10.0.0.0/8`; keep other RFC1918 ranges out. HTTPS origin names must match
the certificate. Kubernetes target registration uses TargetGroupBinding.
ADR-007's internal observability NLBs are a separate private fan-in exception.

Cross-account trust uses configured roles and Secrets Manager ExternalIds.
Sensitive credential values do not belong in source or Terraform state. Grafana's
secret container is managed here; its value and persisted database password are
updated through the protected operator procedure and synchronized through ESO.

## Apply and verify

Use Atlantis PR plan/apply with a review of the actual changes. Apply target groups
before merging bindings and make producer readiness a gate before consumer changes.
A broken deployment tool may require a narrowly scoped, reviewed recovery plan;
record the exception and preserve state ownership. Never use a targeted plan to
claim the whole shared environment is clean.

Read the module guide, [architecture](../docs/architecture.md) and
[release runbook](../docs/runbooks/review-and-release.md). ECS services ignore
revision/count drift; image publication does not roll them. Resolve live IDs and
verify TLS, target health and application behavior rather than relying on a doc's
old deployment snapshot. Update this guide and the affected module context when
ownership or operational contracts change.
