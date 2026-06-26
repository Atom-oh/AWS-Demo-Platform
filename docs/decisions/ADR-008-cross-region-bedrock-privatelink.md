# ADR-008: Cross-region private Bedrock connectivity via TGW + PrivateLink

## Status
Accepted (2026-06-26)

## Context
The multi-AI PR review panel and interactive tooling call Bedrock in us-east-1/us-east-2
(`bedrock-runtime`, `bedrock-mantle` for `openai.gpt-5.5`/codex) from ap-northeast-2 over
the public internet (NAT→IGW). Two consumer VPCs need this private: mgmt-vpc (10.254/16)
and production-vpc (10.2/16), both already attached to the existing TGW `tgw-0162c7d68d7886619`.
Interface endpoints are regional and their private DNS only applies within the endpoint VPC.

## Decision
Reuse the existing ap-ne2 TGW and create per-region us-east TGWs joined by **inter-region TGW
peering** (2 peerings) rather than VPC peering (which would need 2 consumers × 2 regions = 4
peerings). Dedicated endpoint VPCs (10.60.0.0/24, 10.61.0.0/24) host the interface endpoints
with `private_dns_enabled = false`; cross-region name resolution uses Route 53 Private Hosted
Zones (`bedrock-runtime.<r>.amazonaws.com`, `bedrock-mantle.<r>.api.aws`) associated to both
consumer VPCs, pointing to the endpoint ENI private IPs.

## Consequences
- + Both consumers covered with 2 inter-region peerings; existing TGW reused.
- + No public-internet path for us-east Bedrock once consumers resolve via the PHZ.
- − ~$170–220/mo standing cost (4 interface endpoints + 2 TGWs + 2 peerings + data).
- − The module adds routes to a TGW/consumer RTs managed out-of-band; additive only, confirm via `atlantis plan`.
- Alternatives rejected: VPC peering (4 cross-region peerings), relocating codex to us-east (ARC topology rework).
