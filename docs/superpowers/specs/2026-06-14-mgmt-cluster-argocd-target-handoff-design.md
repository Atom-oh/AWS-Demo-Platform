# Management ArgoCD target handoff — historical design

**Date:** 2026-06-14. **Original status:** approved design.
**Reconciled:** 2026-09-13. Target manifests are implemented; current live ownership
was not audited here. Original manifests and analysis remain in Git history.

## Intent and selection

Reuse the existing hub/spoke clusters and transfer GitOps ownership rather than
rebuild infrastructure. The original comparison of 39 source-root targets found
Tempo and ClickHouse missing from this repository's system root. Mall domain
Applications remained tenant-owned; existing destination components took priority
over source versions.

Copy `k8s/system/tempo` and `k8s/system/clickhouse-mgmt`, then add hub-only
ApplicationSets. Retain Tempo's existing S3/IRSA resources and the ClickHouse,
Tempo and Prometheus internal NLBs: removing them from a pruning Application would
interrupt spoke-to-hub telemetry. Alternatives were an ALB migration, which does
not fit ClickHouse native TCP, or ClusterIP-only access, which abandons that
cross-cluster entry point. [ADR-007](../../decisions/ADR-007-mgmt-observability-internal-nlb-exception.md)
records the narrow private fan-in exception.

## Implemented adaptations

The final copy was not verbatim. Tempo's invalid ConfigMap key patches were
removed; the ApplicationSet injects region/bucket into Deployment environment.
ClickHouse's default-user network ACL and NLB source ranges use `10.0.0.0/8`.
The older world-open ACL and fixed SG snippets were superseded. Reachable 10/8
clients still have unauthenticated database access as the ADR's accepted risk.

[Tempo's ApplicationSet](../../../argocd-apps/system/appset-tempo.yaml) retains
`Replace=true`; [ClickHouse's](../../../argocd-apps/system/appset-clickhouse.yaml)
now uses `ServerSideApply=true`. Both target `mall-apne2-mgmt`. The Prometheus
service is in `monitoring`, so that namespace and its selected workload must
already exist; the ClickHouse Application creates only `observability`.

The old merge-then-remove-source sequence could briefly give two roots ownership
of the same Application. It is not a reusable cutover recipe. Inventory and
coordinate source/destination ownership under the
[release runbook](../../runbooks/review-and-release.md), render final manifests,
and verify both sync/health and telemetry flow. A dry-run without required CRDs
is not deployment validation. [Architecture](../../architecture.md) owns the
current topology; non-hub Tempo, tenant workloads and unrelated agents remain
outside this historical slice.
