# Tempo and ClickHouse handoff — historical implementation record

**Date:** 2026-06-14. **Original form:** six-task implementation plan.
**Reconciled:** 2026-09-13; manifests/ApplicationSets exist. Live cross-repository
ownership was not reverified. Embedded manifests, SQL and commands remain in
Git history. See the [design](../specs/2026-06-14-mgmt-cluster-argocd-target-handoff-design.md)
for selection rationale.

## Delivery units and retained trade-offs

The plan copied Tempo and ClickHouse manifests, added their hub-only ApplicationSets,
recorded the internal-NLB exception and synchronized context. Existing clusters,
Tempo S3 storage/IRSA and the ClickHouse operator were reused; this was not a
cluster or storage rebuild. Keeping three private NLB Services preserved
spoke telemetry under ArgoCD pruning.

Implementation corrected the source rather than copying every value:

- Tempo's nonexistent ConfigMap-key patches were dropped. Its ApplicationSet
  supplies Deployment region/bucket values consumed by config expansion.
- ClickHouse's user network ACL became `10.0.0.0/8`; NLB Services use that source
  range instead of the old fixed security-group annotation. The draft's
  world-open ACL/fixed-SG code blocks were pre-hardening snapshots, not final policy.
- `monitoring` and the selected Prometheus workload are external prerequisites;
  creating the ClickHouse destination namespace alone does not satisfy them.
- Tempo keeps `Replace=true`; ClickHouse now specifies `ServerSideApply=true`.

## Current evidence and operational boundary

[Tempo ApplicationSet](../../../argocd-apps/system/appset-tempo.yaml),
[ClickHouse ApplicationSet](../../../argocd-apps/system/appset-clickhouse.yaml),
[Tempo manifests](../../../k8s/system/tempo/) and
[ClickHouse manifests](../../../k8s/system/clickhouse-mgmt/) own the final resource
set and patches. [ADR-007](../../decisions/ADR-007-mgmt-observability-internal-nlb-exception.md)
limits the exception to private fan-in and records residual unauthenticated
ClickHouse access from reachable 10/8 clients.

The original merge-before-source-removal sequence could create dual Application
ownership. Coordinate the actual handoff and inspect consumers before pruning;
use [review/release guidance](../../runbooks/review-and-release.md). Render the
final overlays, validate against the intended cluster with required CRDs and
namespaces, then verify telemetry end to end. The old `--validate=false` examples
and expected 47-test baseline did not prove server acceptance or runtime health.
Tenant workloads, other regions and unrelated agent/placeholder cleanup were
outside this slice.
