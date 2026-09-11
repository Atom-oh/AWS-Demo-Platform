# infra/cloudfront

CloudFront distributions + VPC Origin for the CloudFront-only ingress pattern, where
CloudFront is the sole public entry point and the platform ALB is private. Each
distribution reaches the Internal ALB through `aws_cloudfront_vpc_origin`; listener
rules select target groups. The `*.atomai.click` wildcard
ACM certificate is looked up via `data.aws_acm_certificate` so every distribution reuses the
same pre-existing cert rather than issuing a new one.

- **State**: shared backend bucket `multi-region-mall-terraform-state`.
- **Distributions**: `argocd` (`argocd.atomai.click`), `atlantis`, `dashboard_api`,
  `dashboard_frontend` — all VPC-origin → Internal ALB.
- **External consumer**: Grafana's distribution and DNS are owned by
  `Atom-oh/multi-region-architecture` in its Korea `shared/` state. It consumes this
  module's `cf_vpc_origin_id`; coordinate changes before replacing/removing that
  origin. Do not import the distribution into both states.
- Apply via Atlantis: `atlantis plan -d infra/cloudfront` then
  `atlantis apply -d infra/cloudfront`.

## Incident log
- **2026-09-11**: Atlantis webhook delivery was blocked by an expired viewer
  certificate. A reviewed recovery plan updated only the Atlantis distribution's
  certificate binding to the existing valid wildcard selected by the data source.
  HTTPS health then passed and normal Atlantis plan/apply resumed. This did not
  issue a new certificate or assert that every other endpoint was healthy.
- **2026-06-24**: `aws_cloudfront_distribution.argocd` (`E30DX8JLNHJL7C`,
  `argocd.atomai.click`) was deleted directly in AWS (not via Terraform/Atlantis) —
  CloudTrail shows `DeleteDistribution` from `mgmt-vpc-VSCode-Role` (EC2
  `i-01b6ac753a2543e39`), part of a batch of 3 `DeleteDistribution` calls 41s apart
  (the other 2 IDs belong to unrelated distributions outside this module). No
  accompanying commit/PR — looked accidental, not a deliberate decommission. Left
  `argocd.atomai.click` unresolvable (DNS/CloudFront gone) while the underlying
  ArgoCD server stayed healthy in-cluster the whole time. Surfaced 2026-07-05 via an
  unrelated `atlantis.yaml` edit that triggered a full autoplan sweep. Recreated via
  `atlantis apply -d infra/cloudfront` (pure re-add, 0 changes/destroys to the other
  3 distributions) — new distribution ID, same config/aliases/cert.
