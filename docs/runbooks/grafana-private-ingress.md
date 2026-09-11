# Grafana private ingress and administrator operations

## Current contract and ownership

Public requests use `grafana-kr.atomai.click` or `grafana.atomai.click` → CloudFront
→ VPC Origin → internal ALB HTTPS listener, priority 140 → Grafana Pod IPs on port
3000. `monitoring/grafana` TargetGroupBinding references the existing
`prometheus-mall-apne2-mgmt-grafana` ClusterIP Service to register those Pod IPs.
Neither the binding object nor the Service ClusterIP is an additional ALB traffic hop.

| Resource | Owner / reference |
| --- | --- |
| Grafana distribution and public aliases | `Atom-oh/multi-region-architecture`, Korea `shared/` Terraform state |
| Shared VPC Origin | This repository, `infra/cloudfront`, output `cf_vpc_origin_id` |
| Internal ALB and Grafana target group | This repository, `infra/alb-internal`; `demo-platform-internal` and `demo-platform-grafana` |
| TargetGroupBinding, dashboard ConfigMaps and ExternalSecret | `k8s/system/grafana`, synced by `grafana-dashboards-mall-apne2-mgmt` |
| Grafana deployment and sidecars | `argocd-apps/system/appset-helm-prometheus-mgmt.yaml`, child Application `prometheus-mall-apne2-mgmt` |
| Administrator value | Secrets Manager `/demo-platform/grafana/admin`, JSON `username` / `password` |

The repository already configures the chart and both sidecars to use
`monitoring/grafana-admin`. Its Secret keys are `admin-user` and `admin-password`.
The persisted login remains `admin`; changing the JSON username alone does not
rename that database account. Terraform manages only the secret container, with
seven-day recovery; older dashboard `slot` resources retain their zero-day policy.

Resolve live IDs from outputs/APIs before operations. The 2026-09-11 recovery used
CloudFront `E2T67VYMCTJW6A` and VPC Origin `vo_22VbzKdu79hDrHuT2h1j2B`; these are
incident references, not a substitute for checking the current owners and bindings.
Never import the distribution into both Terraform states.

## Ingress deployment or recovery

1. Verify AWS identity and the selected `mall-apne2-mgmt` context/account. Inspect
   CloudFront/DNS, TLS and target health in both owning repositories.
2. Plan/apply `infra/alb-internal` through Atlantis. Apply the target group before
   merging a binding that resolves it by name. The ALB SG remains HTTPS from the
   CloudFront VPC Origin source SG plus `10.0.0.0/8` only.
3. Merge/sync the binding and verify at least one healthy current Pod target on
   port 3000. Inspect Pod SG connectivity through the supported infrastructure
   path if needed; do not open broad ingress as a shortcut.
4. Verify the managed administrator works and the default is rejected. If rotating
   a default/unmanaged value, use the procedure below regardless of whether the
   external route is already reachable.
5. In the Grafana distribution's owning repository, review/apply the private-origin
   change. Preserve the existing distribution, aliases, wildcard certificate,
   `Managed-CachingDisabled` and `Managed-AllViewer`; both viewer hosts must match
   the ALB rule. The HTTPS origin hostname must match the certificate SAN.
6. Wait for CloudFront deployment and run public checks. Remove obsolete origins
   only after identifying all consumers and validating the replacement.

If a binding was merged before its target group and sync exhausted its retries,
fix the prerequisite and explicitly re-sync the same revision through ArgoCD.
An authorized, reviewed targeted Terraform plan may be appropriate for incident
recovery; record its scope and reconcile source afterward. It does not validate
unrelated shared-state resources.

## Rotate an existing administrator credential

Changing a Kubernetes Secret or Helm value does not rotate the persisted Grafana
database password. With `existingSecret`, a Secret value change also does not
restart containers or refresh their environment variables automatically.

1. Confirm the current account is the intended persisted `admin` login. Preserve
   access to the existing value and stage the generated replacement in Secrets
   Manager as `AWSPENDING`; keep values out of Git, Terraform, command arguments
   and logs.
2. Authenticate as that administrator and call `PUT /api/user/password` with
   `oldPassword`, `newPassword` and `confirmNew` through a protected operator
   process. If public routing is unavailable, use the internal ALB with verified
   TLS from an authorized 10/8 host, or an authenticated loopback-only Kubernetes
   port-forward. Do not disable certificate validation to send credentials.
3. Verify `/api/user` succeeds with the new value and rejects the actual previous
   password. Also check default rejection when replacing a default credential,
   then promote the verified version to `AWSCURRENT` and clean up staging labels.
   If interrupted, inspect actual authentication and version stages before retrying;
   promotion may have succeeded even if a later cleanup failed. Retain the working
   value for recovery rather than generating another blindly.
4. Refresh ESO or wait for its configured one-hour interval. Require ExternalSecret
   Ready and compare both Kubernetes Secret values with AWSCURRENT in memory,
   without printing them. Ready alone may describe an older synchronized value.
5. Roll Grafana through GitOps so the main container and both sidecars reload the
   Secret: add/update a non-secret rollout marker under `grafana.podAnnotations`
   in `argocd-apps/system/appset-helm-prometheus-mgmt.yaml`, then review/merge and
   sync it. Keeping the changed Pod template in Git avoids self-heal removing an
   out-of-band restart annotation and causing another `Recreate` rollout. Never
   use a credential value as the rollout marker.
6. Verify rollout completion, all six credential references, target health, login
   and an authenticated datasource query. Until consumers restart, old sidecar
   credentials can cause provisioning-reload 401s. Avoid repeated bad logins while
   checking rejection.

## Introduce a new Secret producer or consumer

This sequence is for first setup or a Secret-name/ownership migration, not a demand
to reopen the original rollout PRs for each password rotation.

1. Land only the producer/container changes. Apply the container through Atlantis,
   populate the managed value and perform any required database rotation.
2. Sync the producer Application. Require
   `kubectl --context mall-apne2-mgmt -n monitoring wait --for=condition=Ready externalsecret/grafana-admin --timeout=90s`
   and verify key/value agreement with AWSCURRENT. Confirm ESO is permitted to read
   the relevant `/demo-platform/` path without broadening IAM unnecessarily.
3. Only then merge the separate consumer change in
   `argocd-apps/system/appset-helm-prometheus-mgmt.yaml`. Producer and consumer
   Applications have no implicit ordering. On a fresh cluster, a missing Secret
   prevents Grafana from starting; resolve the producer rather than falling back
   to a weak default.
4. Complete the rollout and verification promptly. Do not prune the producer while
   Grafana depends on it.

## Verification and rollback boundaries

- Dashboard and Prometheus Applications: intended revision/configuration, Synced
  and Healthy. The Helm Application's revision is its chart version, not a Git SHA.
- Deployment: updated Pods Ready; Grafana and both sidecars reference `grafana-admin`.
- Target group: current Pod IP registered and healthy on port 3000.
- Both public aliases: TLS valid, `/api/health` and `/login` return 200; anonymous
  `/api/user` returns 401; managed authentication and a real datasource query succeed.
- Administrator: replaced password rejected, chart default rejected when applicable,
  and authoritative managed value preserved.
- ALB: HTTPS ingress remains exactly the CloudFront source SG plus `10.0.0.0/8`.

Reverting the Helm consumer does not undo the database password change and can
regenerate credentials that no longer match it. Use the known managed value and
coordinate database, Secret and consumer rollout. Do not recreate the public NLB
as a rollback shortcut. See [ADR-018](../decisions/ADR-018-grafana-private-origin.md)
and the [review/release runbook](review-and-release.md) for the incident lessons.
