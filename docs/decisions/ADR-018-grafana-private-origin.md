# ADR-018: Restore Grafana through the shared private origin

**Status:** Accepted — 2026-09-11

## Historical context

The September 11 incident record reports that PR #98 removed the public HTTP
Grafana NLB while the externally owned CloudFront distribution still referenced
it. Grafana Pods remained healthy but public requests returned 502. Distribution
`E2T67VYMCTJW6A` is an incident identifier, not a current inventory lookup.

AI review noted the unverified external dependency; a passing diff review and
ArgoCD Healthy therefore did not establish public availability. The restoration
also found a still-valid default administrator credential. These are dated incident
observations, not claims about today's route or password.

## Decision and ownership

Reuse the existing distribution, aliases and wildcard certificate with the shared
HTTPS VPC Origin. Use `grafana-kr.atomai.click` as origin host so SNI matches the
ALB certificate. Preserve AllViewer, disabled caching, methods and public aliases.

| Resource | Owner |
| --- | --- |
| Shared VPC Origin | This repository's `infra/cloudfront` |
| Internal ALB, listener priority 140, IP target group port 3000 | This repository's `infra/alb-internal` |
| Binding, dashboards and administrator ExternalSecret | `k8s/system/grafana` |
| Grafana Helm consumer | `argocd-apps/system/appset-helm-prometheus-mgmt.yaml` |
| Grafana distribution and public DNS | `Atom-oh/multi-region-architecture`, Korea `shared/` state |

The binding registers Pod IPs from the existing ClusterIP Service; it is not a
traffic hop. Keep the ALB HTTPS SG restricted to the CloudFront VPC Origin source
SG plus `10.0.0.0/8`. Never import the distribution into both states. ADR-007's
internal fan-in exception does not permit a public Grafana fallback.

## Deployment and credential ordering

1. Apply the target group/listener before syncing the binding. Require a healthy
   current Pod target before changing the external owner's CloudFront origin.
2. For initial credential setup or a producer migration, land the Secrets Manager
   container and ExternalSecret first. Populate the managed value and rotate the
   persisted database credential if it differs; any still-valid default credential
   must be rotated. Verify database login, ESO Ready and agreement between Secrets
   Manager and the Kubernetes Secret before a separate consumer change. Verify
   container credentials after that rollout. Independently synchronized Applications
   have no implicit ordering.
3. The current Helm values already use `grafana-admin`. Ordinary rotation updates
   the database and authoritative secret, waits for ESO synchronization, then
   rolls Grafana and both sidecars using a reviewed non-secret Pod-template marker.
   A Secret update alone neither changes the database password nor reloads existing
   container environment variables. Do not reopen the original migration for every
   rotation, or prune the producer while consumers depend on it.
4. Verify both public aliases, TLS, `/login`, `/api/health`, anonymous API rejection,
   managed login and a real datasource query. Also verify the six credential
   references in the Helm-rendered Pod spec and unchanged ALB ingress rules.
5. Retire obsolete routing only after inventorying consumers across both owners
   and completing public checks. Source presence, successful apply, GitOps health
   and completed AI review are separate evidence.

The administrator container has a seven-day recovery window; older dashboard
slots retain zero days. Passwords stay out of Git/Terraform state. Preserve the
verified database login identity; editing a Secret username does not rename it.
A consumer revert is not a database-password rollback: retain the known working
managed value and coordinate all consumers.

Use the [Grafana runbook](../runbooks/grafana-private-ingress.md) for the full
rotation/recovery procedure and [release runbook](../runbooks/review-and-release.md)
for cutover evidence. Recreating the public NLB is not a rollback option.
