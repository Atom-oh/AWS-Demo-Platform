# ADR-018: Restore Grafana through the shared private origin

**Status:** Accepted — 2026-09-11

## Context

PR #98 removed the public HTTP Grafana NLB to enforce the existing CloudFront-only
ingress rule. The Grafana Pod stayed healthy, but CloudFront distribution
`E2T67VYMCTJW6A` still referenced the deleted NLB and returned HTTP 502. That
distribution belongs to `multi-region-architecture` Terraform, outside the
manifest change reviewed in this repository.

The AI review passed the repository diff while correctly noting the unverified
external dependency. A passing review and ArgoCD `Healthy` status therefore did
not establish end-to-end availability.

## Decision

Reuse the existing Grafana distribution, aliases and certificate. Change its
origin in the owning Terraform configuration to the existing
`demo-platform-alb-internal` VPC Origin. Use `grafana-kr.atomai.click` as the origin
domain so HTTPS SNI matches the wildcard certificate on the internal ALB.

This repository adds an IP target group on port 3000, health-checked at
`/api/health`, and HTTPS listener priority 140 for both Grafana aliases. A
TargetGroupBinding registers pods through the existing ClusterIP Service. Keep
the ALB security group limited to the CloudFront service SG plus `10.0.0.0/8`.
Preserve CloudFront's disabled caching, forwarded viewer headers/cookies and
methods, and existing public DNS aliases.

Ownership stays split: AWS Demo Platform owns the ALB, VPC Origin and Kubernetes
binding; multi-region-architecture owns the Grafana distribution and DNS. Do not
import the same distribution into a second Terraform state.

## Deployment and verification

Apply the target group and listener rule first, then sync the binding. Wait for a
healthy registered target before switching CloudFront's origin. Verify both
public aliases, `/login`, `/api/health`, unauthenticated API protection, and the
unchanged ALB ingress rules. Keep these checks separate from AI diff review.

See `docs/runbooks/grafana-private-ingress.md`. The public NLB is not a rollback
option; repairs must preserve the private-origin path.

## Administrator credential rollout

Pre-cutover testing confirmed the chart default administrator credential was
still valid. Store the replacement in Secrets Manager and synchronize it through
ESO, preserving the existing `admin` login. Use a separate seven-day recovery
window for this credential container; the older dashboard slots keep their
zero-day policy. Values are managed out-of-band, never in Terraform state.

The persisted Grafana database must be rotated through the API and verified
against the managed value. Land the container and ExternalSecret first and require
ESO Ready before a separate Helm consumer change. This avoids a race between
the dashboard and Prometheus Applications: `Recreate` cannot start Grafana while
its referenced Secret is absent. Sidecar credentials must match the database,
so complete the consumer rollout promptly after rotation.
