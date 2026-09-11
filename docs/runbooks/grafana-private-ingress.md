# Grafana private ingress

## Ownership and path

`grafana-kr.atomai.click` and `grafana.atomai.click` → CloudFront
`E2T67VYMCTJW6A` → VPC Origin `vo_22VbzKdu79hDrHuT2h1j2B` → internal ALB
`demo-platform-internal` (HTTPS, priority 140) → target group
`demo-platform-grafana` (HTTP 3000) → `monitoring/grafana` TargetGroupBinding →
`prometheus-mall-apne2-mgmt-grafana` ClusterIP Service.

CloudFront and DNS are Terraform-managed in `Atom-oh/multi-region-architecture`,
`terraform/environments/production/ap-northeast-2/shared`; the ALB and target group
are in this repository's `infra/alb-internal`. Never manage the distribution in
both states. The VPC Origin remains in this repository's `infra/cloudfront`.

## Deploy

1. Plan and apply `infra/alb-internal` through Atlantis. Require a plan limited to
   the intended target group/listener changes and inspect any security-group diff.
2. Confirm the chosen Kubernetes context resolves to `mall-apne2-mgmt`. Merge the
   binding and allow `grafana-dashboards-mall-apne2-mgmt` to sync from main.
3. Verify a healthy IP target on port 3000. The Grafana Pod ENI must allow that port
   from the internal ALB; change security groups through Terraform if needed.
4. In the owning repository, review and apply the Grafana distribution's
   private-origin change. Preserve aliases, the existing wildcard certificate,
   `Managed-CachingDisabled`, and `Managed-AllViewer`.
5. Wait for CloudFront deployment and run the checks below.

Before an external cutover, confirm the chart's default administrator credential
is rejected. The administrator credential lives in Secrets Manager at
`/demo-platform/grafana/admin` as JSON `username`/`password`. ESO synchronizes it
to `monitoring/grafana-admin`, which the Grafana chart and its sidecars reference.
Terraform manages only the empty secret container.

When replacing a default credential, populate the secret through a protected
operator process and update the existing Grafana administrator through its API
before exposing the route. The persisted Grafana database does not automatically
change its password when the Kubernetes Secret changes. Roll Grafana after ESO
reports Ready so its sidecars receive the matching credential, then verify a
successful authenticated query and rejection of the old default. Never place the
password in Git, a Terraform value, a command argument, or log output.

During an outage, a separately reviewed targeted apply of the Grafana
distribution may isolate the repair from unrelated changes in the shared state.
Record the selected resource and plan; reconcile the source through a PR.

## Verify

- `kubectl --context mall-apne2-mgmt -n argocd get application grafana-dashboards-mall-apne2-mgmt`:
  Synced/Healthy at the intended commit.
- `kubectl --context mall-apne2-mgmt -n monitoring get targetgroupbinding grafana`:
  binding present; inspect events if reconciliation fails.
- `aws elbv2 describe-target-groups --names demo-platform-grafana --region ap-northeast-2`,
  then `describe-target-health` with the returned ARN: at least one healthy target.
- Both public hostnames: `/api/health` and `/login` return 200; an unauthenticated
  `/api/user` request returns 401 rather than account data.
- The chart default administrator login is rejected. An authenticated
  administrator request and a datasource query succeed with the managed secret.
- ALB HTTPS ingress remains exactly the CloudFront VPC Origin source SG plus
  `10.0.0.0/8`. No internet-facing Grafana NLB is recreated.

If the Pod and ArgoCD are healthy but public requests return 502, inspect
CloudFront's origin and its owning Terraform before removing or recreating load
balancers. Check DNS aliases and origin dependencies before destructive changes;
repository-local AI review cannot discover every live dependency.

## Authentication on the development instance

The instance profile `mgmt-vpc-VSCode-Role` supplies existing AWS credentials.
A sandboxed CLI can report `NoCredentials` when metadata access is blocked.
Verify `aws sts get-caller-identity` with the required network access before
concluding credentials are absent. Never print credential values.
