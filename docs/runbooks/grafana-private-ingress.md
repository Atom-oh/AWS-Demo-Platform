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
4. Complete the administrator procedure below if replacing a default or
   unmanaged credential. This is mandatory regardless of whether the external
   route is currently available.
5. In the owning repository, review and apply the Grafana distribution's
   private-origin change. Preserve aliases, the existing wildcard certificate,
   `Managed-CachingDisabled`, and `Managed-AllViewer`.
6. Wait for CloudFront deployment and run the checks below.

During an outage, a separately reviewed targeted apply of the Grafana
distribution may isolate the repair from unrelated changes in the shared state.
Record the selected resource and plan; reconcile the source through a PR.

## Administrator credential: two separate rollout phases

The credential is JSON `username`/`password` in
`/demo-platform/grafana/admin`. Keep `username` equal to the existing persisted
login, `admin`; this procedure does not rename users. Terraform creates only the
container. The existing database does not adopt a new password from Helm or a
Kubernetes Secret.

1. **Phase A:** open a PR containing only the Terraform container, ExternalSecret
   and documentation. Do not include `grafana.admin.existingSecret` in this PR.
   Apply `infra/secrets-manager` through Atlantis and confirm the container exists.
2. Generate a strong value in a protected operator process and store it as
   `AWSPENDING`. With the existing administrator authenticated, call
   `PUT /api/user/password` with `oldPassword`, `newPassword` and `confirmNew`;
   supply those fields from process memory, never command arguments or logs.
   Verify `/api/user` succeeds as the existing administrator with the staged
   password and rejects the old default before promoting that version to
   `AWSCURRENT`. This API update is mandatory, including when Grafana is already
   publicly reachable. Retain the staged value for recovery if any step fails.
3. Merge phase A and wait for the dashboard Application to sync. Confirm
   `kubectl --context mall-apne2-mgmt -n monitoring wait --for=condition=Ready externalsecret/grafana-admin --timeout=90s`
   succeeds. Verify both expected Secret keys exist without printing their values.
4. **Phase B:** only after the preceding checks succeed, open and merge a
   separate Helm-values PR setting `grafana.admin.existingSecret: grafana-admin`,
   `userKey: admin-user` and `passwordKey: admin-password`. Do not combine this
   consumer change with phase A: the two auto-synced Applications have no ordering
   guarantee. Complete phase B promptly after rotation so sidecars receive the
   matching credential.
5. Wait for the Grafana rollout, healthy target and successful authenticated
   datasource query. Confirm default rejection again if needed without repeatedly
   attempting bad logins. Only then complete an external origin cutover.

The Grafana container has a seven-day recovery window; the older dashboard
`aws_secretsmanager_secret.slot` resources retain their zero-day policy.
Never place a password in Git, Terraform state or log output.

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
