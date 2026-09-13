# CloudFront

`main.tf` owns four distributions (`argocd`, `atlantis`, `dashboard_api`,
`dashboard_frontend`) and one shared HTTPS-only VPC Origin to the internal ALB.
The viewer wildcard certificate is looked up in `us-east-1`; origin hostnames
must match the ALB certificate and listener rules. See the
[ingress contract](../CLAUDE.md).

- State key: `production/aws-demo-platform/cloudfront/terraform.tfstate`.
- Dashboard frontend default and `/api/*` behaviors use `AllViewerExceptHostHeader`
  and `CachingDisabled`; `/api/*` selects `admin-api-dev.atomai.click`. Atlantis,
  ArgoCD and the separate API distribution use AllViewer and disabled caching.
- Grafana's distribution/DNS remain in `Atom-oh/multi-region-architecture`'s Korea
  `shared/` state. That external consumer uses `cf_vpc_origin_id`; inspect it
  before replacing/removing the origin. Never import it into both states.
- Apply the ALB dependency first, then use `atlantis plan -d infra/cloudfront`
  and `atlantis apply -d infra/cloudfront` in PR comments.

Past recovery notes report ArgoCD distribution recreation in July 2026 and an
Atlantis viewer-certificate repair on 2026-09-11. Those observations are not
current IDs or endpoint-health evidence. Recheck TLS, webhook delivery and every
affected consumer; use the [release runbook](../../docs/runbooks/review-and-release.md)
for a scoped recovery.
