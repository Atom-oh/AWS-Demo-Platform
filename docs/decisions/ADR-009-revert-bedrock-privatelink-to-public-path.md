# ADR-009: Revert cross-region Bedrock PrivateLink; return to public NAT→IGW path

## Status
Accepted (2026-07-05) — supersedes ADR-008

## Context
ADR-008 built cross-region private Bedrock connectivity (dedicated us-east-1/us-east-2
endpoint VPCs with `bedrock-runtime`/`bedrock-mantle` interface endpoints,
`private_dns_enabled=false`, two regional TGWs joined to the existing ap-ne2 TGW by
inter-region peering, static TGW/consumer routes, and 4 Route 53 PHZs with A records
to the endpoint ENIs). The goal was to keep the multi-AI PR-review panel's Bedrock
calls off the public internet.

In practice the stack cost ~$170–220/mo standing (4 interface endpoints + 2 TGWs +
2 inter-region peerings + data processing) and became a recurring debugging burden:
the cross-region DNS + routing chain was the suspected cause of the flaky AI Code
Review panel (codex + Claude chair intermittently not responding while Kiro did).
One real bug in this path was found and fixed (a missing route-table entry for a
Karpenter-scheduled AZ), but the same failure signature recurred afterward with no
further misconfiguration found — `AWS/Bedrock` CloudWatch metrics showed zero
invocation attempts during a failure window, meaning requests never reached Bedrock
at all, while every checked layer (routes, DNS, SG, NACL, IAM, TGW peering state)
was correct. The consumer VPCs already have `available` NAT Gateways with active
`0.0.0.0/0 → nat` routes, so the public path (NAT→IGW) is intact and requires zero
code changes — no CI workflow or script hardcodes anything module-specific; they
only reference the public `bedrock-runtime.<region>.amazonaws.com` hostname.

## Decision
Decommission `infra/bedrock-privatelink/` entirely and revert to the pre-ADR-008
baseline: Bedrock in us-east-1/us-east-2 is reached from the ap-ne2 consumer VPCs
over the public path (NAT Gateway → Internet Gateway). Destruction is done via
Atlantis in two PRs — PR #53 removed the resource `.tf` files (keeping
`providers.tf`/`versions.tf` so the empty config plans a full destroy) and applied
it; this PR removes the remaining scaffold, the `atlantis.yaml` project block, and
the architecture doc row. The module's "add-only" contract guarantees the shared
TGW, its default route table, and the consumer VPCs/route tables (all data-sourced)
are left untouched; only what the module added is removed. Once the PHZs are gone,
`bedrock-runtime.*` resolves publicly again and traffic flows NAT→IGW automatically.

## Consequences
- + ~$170–220/mo standing cost eliminated (endpoints, TGWs, peerings, data processing).
- + No more cross-region PrivateLink network stack to debug; the AI Code Review panel
    now depends only on the simple public egress path.
- + Fewer moving parts: no dedicated endpoint VPCs, TGW peerings, or multi-VPC PHZs.
- − Bedrock calls traverse the public internet again (via NAT→IGW), returning to the
    exact network posture that predated ADR-008. If a private posture is required
    later, re-introduce a PrivateLink design with better observability (VPC Flow Logs
    from day one) so recurrences are diagnosable.
- ADR-008 is retained as immutable historical record, marked Superseded by this ADR.
