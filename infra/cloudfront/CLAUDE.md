# infra/cloudfront

CloudFront distributions + VPC Origin for the CloudFront-only ingress pattern (no
public ALB/NLB, no Kubernetes Ingress). Each distribution's origin is an Internal
ALB target group reached via `aws_cloudfront_vpc_origin`, with the `*.atomai.click`
wildcard ACM cert (`data.aws_acm_certificate`, never a new cert).

- **State**: shared backend bucket `multi-region-mall-terraform-state`.
- **Distributions**: `argocd` (`argocd.atomai.click`), `atlantis`, `dashboard_api`,
  `dashboard_frontend` — all VPC-origin → Internal ALB.
- Apply via Atlantis: `atlantis plan -d infra/cloudfront` then
  `atlantis apply -d infra/cloudfront`.

## Incident log
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
