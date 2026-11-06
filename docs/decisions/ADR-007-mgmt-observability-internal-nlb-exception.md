# ADR-007: Internal NLB exception for hub observability fan-in

## Status

Accepted (2026-06-14). Limited to private observability fan-in.

## Context

Public ingress uses CloudFront → VPC Origin → internal ALB → target IPs.
The AWS Load Balancer Controller reconciles TargetGroupBinding to register Pod
IPs from Services; TGB is not a traffic hop. The public-ingress convention does
not provide ClickHouse's native TCP transport between clusters.

The June 2026 hub handoff reported three existing internal NLBs carrying
spoke-to-hub telemetry. Retaining them avoided pruning active collection paths.
That is dated migration evidence, not a current health or consumer inventory.

## Decision and implemented scope

Keep the three Services in
[`internal-nlb-services.yaml`](../../k8s/system/clickhouse-mgmt/internal-nlb-services.yaml):

| Service | Namespace | Ports / purpose |
| --- | --- | --- |
| `clickhouse-nlb` | `observability` | 9000 native TCP, 8123 HTTP |
| `tempo-nlb` | `observability` | 4317 OTLP gRPC, 3200 HTTP |
| `prometheus-nlb` | `monitoring` | 9090 remote-write |

Each manifest selects IP targets, `scheme=internal` and
`loadBalancerSourceRanges: ["10.0.0.0/8"]`. The annotation naming load-balancer
**type** `external` selects the controller integration; it does not override the
internal scheme. Verify resulting SGs, targets and routes before operational
changes. These NLBs have no CloudFront origin and accept only the private source
range; the platform ALB separately permits its CloudFront source SG plus 10/8.

```mermaid
flowchart LR
  OC[Spoke OTel collectors] --> CHN[Internal ClickHouse NLB] --> CH[Hub ClickHouse]
  OC --> TN[Internal Tempo NLB] --> T[Hub Tempo]
  PA[Spoke Prometheus agents] --> PN[Internal Prometheus NLB] --> P[Hub Prometheus]
```

Alternatives were ALB-only transport, which cannot carry ClickHouse native TCP,
and ClusterIP-only backends, which would remove the chosen cross-cluster collection
path. Keep the NLB exception private and limited to fan-in; it never permits a
public Grafana NLB or Kubernetes Ingress.

## Consequences and accepted risk

The checked-in [ClickHouseInstallation](../../k8s/system/clickhouse-mgmt/clickhouse-installation.yaml)
sets the `default` user's network ACL to `10.0.0.0/8` and does not configure a
password. The handoff recorded unauthenticated exporters. Hosts with network
reachability within that range can therefore access the database without authentication
under this configuration; actual reachability/authentication still needs runtime
verification. This residual risk was accepted for the reused non-production hub,
not as a general database security pattern.

Runtime check on 2026-11-06: an HTTP query from the TGW-connected mgmt VPC
returned `default` without credentials, confirming the exposure. The ClickHouse
PrivateLink service also admits consumers whose traffic arrives from NLB
addresses inside this range. New consumers therefore use credentialed users:
`ttobak` (password via ESO from `/demo-platform/clickhouse/ttobak`, restricted
to the `otel` database) is the first. Its explicit `grants/query` limits it to
SELECT, INSERT, ALTER and the exporter's CREATE privileges on `otel.*`, replacing
the broad global privileges a users.xml user otherwise receives. ClickHouse
rejects `grants` combined with `allow_databases` (a 24.8 server with both exits
at startup, code 36), so the user has grants only. Verified on the same
24.8 image: the grants-only user lists no other databases and receives
`ACCESS_DENIED` (497) for `system.query_log`, `system.processes` and
`system.users`, so the `ttobak` credential itself cannot read other users'
query metadata. This is not a platform-wide guarantee: the unauthenticated
`default` user still can until it is locked. Locking `default` remains the separate
coordinated hardening described below.

A future hardening change must coordinate credentials/exporters or narrower
source ranges. Inventory live consumers before removal: the owning
[ClickHouse ApplicationSet](../../argocd-apps/system/appset-clickhouse.yaml)
uses pruning, so deleting the Service manifests can remove their load balancers.
A single-cluster replacement needs its own verified cutover.

See [project tolerance and ingress rules](../../CLAUDE.md),
[architecture](../architecture.md) and [Grafana's separate route](ADR-018-grafana-private-origin.md).

## Operational amendment: data volume retention

Disk incident 2026-11-06 (operational amendment): the 100 GiB data volume
reached 100% (`Cannot reserve 1.00 MiB`), rejecting every insert. About 60 GiB
was ClickHouse system log tables without retention. Otel data past its 30-day
TTL also remained, because TTL deletion runs as background merges that need
free space; once the disk filled, no merge (and no TTL removal) could run.
The operator expanded the PVC online to 200 GiB, truncated the system log
tables and ran `ALTER TABLE ... MATERIALIZE TTL` on the otel tables (usage fell
to 24%). The CHI now sets 200 GiB and a 7-day TTL for the system log tables
(`system_log_ttl.xml`), keeping merge headroom so the otel TTL keeps running.

When `system_log_ttl.xml` first loads, ClickHouse renames each system log table
whose definition changed to `<name>_N` (for example `query_log_0`) and creates a
new table with the TTL; the renamed tables never expire. After the rollout,
list them with `SELECT name FROM system.tables WHERE database='system' AND
match(name, '_log_[0-9]+$')` and drop them on each node; a table over
`max_table_size_to_drop` (50 GB default) needs the documented override. No
volume-usage alert exists yet; adding one (for example at 80%) is a follow-up.

