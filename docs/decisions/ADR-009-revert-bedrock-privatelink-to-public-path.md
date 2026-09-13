# ADR-009: Return Bedrock connectivity to public egress

## Status

Accepted (2026-07-05). Fully supersedes
[ADR-008](ADR-008-cross-region-bedrock-privatelink.md).

## Historical context

ADR-008 introduced endpoint VPCs, regional TGWs/peerings, routes and private DNS
for the then-selected US Bedrock endpoints. The July investigation recorded a
missing route for a Karpenter-scheduled AZ, then recurring review failures after
that route was fixed. A failure window showed no Bedrock invocation metrics;
this did not establish the private network as the sole cause of every failure.

The design's $170–220/month estimate and recurring diagnostic burden outweighed
its private-path benefit for this non-production platform. NAT gateways/default
routes were reported available during that investigation. Those observations are
not current route, billing or endpoint-health evidence.

## Decision

Remove the dedicated PrivateLink stack and return consumers to public service
endpoints through their existing NAT/IGW egress. The historical removal used two
stages: destroy the module-owned resources with reviewed plans, then remove the
empty scaffold and Atlantis registration. The shared TGW and consumer VPCs were
outside that module's ownership; their preservation had to be checked in the plan,
not inferred from an “add-only” label.

The current checkout has no `infra/bedrock-privatelink/` root or Atlantis project.
This ADR establishes an egress decision, **not a permanent us-east model/region
pin**. Current model, endpoint and signing-region choices are in
[the workflow](../../.github/workflows/pr-review.yml),
[runner config](../../docker/actions-runner-claude/config.toml) and
[review scripts](../../scripts/pr-review/). Reconcile those sources before
troubleshooting; removing private DNS does not by itself prove successful calls.

## Consequences

The dedicated cross-region endpoint/routing layer is removed, with its associated
standing-cost sources. Actual savings and live network state require separate
measurement. Review still depends on working DNS/egress, credentials, model access
and valid requests; a public path does not guarantee model responses.

If private connectivity becomes a requirement, use a new reviewed design with
flow logs, dependency ownership and end-to-end tests. This historical decommission
record is not authorization to delete other current network resources.
