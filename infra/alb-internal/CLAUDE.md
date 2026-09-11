# Internal ALB

This module owns `demo-platform-internal`, its HTTPS listener and IP target groups.
Its state key is `production/aws-demo-platform/alb-internal/terraform.tfstate` in
`multi-region-mall-terraform-state`. Apply through this repository's Atlantis with
Terraform 1.9.6 and DynamoDB locking.

The ALB security group allows HTTPS only from the CloudFront VPC Origin service
security group and `10.0.0.0/8`. Reuse the existing wildcard certificate through
the ACM data source.

Grafana uses listener priority 140 for `grafana-kr.atomai.click` and
`grafana.atomai.click`, forwarding to `demo-platform-grafana` on port 3000.
`k8s/system/grafana/tgb.yaml` binds the existing ClusterIP Service to that target
group. Apply the Terraform target group before syncing the binding.

The Grafana CloudFront distribution and its public DNS records remain owned by
`Atom-oh/multi-region-architecture` under
`terraform/environments/production/ap-northeast-2/shared`. That distribution
reuses the VPC Origin exported by this repository's `infra/cloudfront` module.
Validate the target health and both public Grafana hostnames after a routing change.
