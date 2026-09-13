# Management manifest migration — historical design

**Date:** 2026-06-03. **Original status:** implemented.
**Reconciled:** 2026-09-13. Repository manifests support the source handoff;
this document does not reverify live ownership. Original examples remain in Git history.

## Intent and scope

Make AWS Demo Platform the Git source for hub system manifests while retaining
existing clusters. Four manifest groups still sourced from
`multi-region-architecture` (MRA): Grafana dashboards, StorageClasses,
runner-scheduler and Karpenter base/overlays. Their manifests moved into
`k8s/system/` and their ApplicationSets were repointed here.

Tenant workloads remained in MRA. Runner `githubConfigUrl` identifies the
repository receiving runners, not a manifest source; those values were outside
this migration. Terraform/state migration and upstream file deletion were
separate ownership tasks. Sibling Karpenter bases had to move with their overlays.

## Trade-offs and corrections

The intended cutover copied existing resources to minimize changes and used
Kustomize rendering plus ArgoCD sync/health checks. It was not wholly byte-identical:
the old public `grafana-nlb.yaml` was deliberately omitted because it violated
CloudFront-only public ingress. That omission could prune an active route and
was not itself proof of a complete Grafana replacement.

Grafana's later private-route/credential work is recorded in
[ADR-018](../../decisions/ADR-018-grafana-private-origin.md). Future cutovers must
inventory cross-repository consumers, verify a replacement and only then retire
the old resource; use the [release runbook](../../runbooks/review-and-release.md).
The internal NLB exception in
[ADR-007](../../decisions/ADR-007-mgmt-observability-internal-nlb-exception.md)
permits private observability fan-in, not a public Grafana fallback.

## Current sources

[System ApplicationSets](../../../argocd-apps/system/),
[system manifests](../../../k8s/system/) and
[current architecture](../../architecture.md) define present paths and ownership.
The old claim that no hub system source remained in MRA was an acceptance target;
verify actual Application sources before deleting upstream definitions.
