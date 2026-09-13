# ADR-008: Cross-region private Bedrock connectivity via TGW and PrivateLink

## Status

Fully superseded by [ADR-009](ADR-009-revert-bedrock-privatelink-to-public-path.md)
on 2026-07-05. Historical design only; `infra/bedrock-privatelink/` is absent from
the current repository and is not an apply target.

## Historical context and decision

The design sought private Bedrock runtime/mantle access from the Seoul management
and production VPCs to then-selected endpoints in `us-east-1` and `us-east-2`.
It reused the Seoul TGW and proposed two regional endpoint VPCs
(`10.60.0.0/24`, `10.61.0.0/24`), two US TGWs and two inter-region TGW peerings.
Interface endpoints disabled private DNS; Route 53 private hosted zones associated
with both consumer VPCs mapped service names to endpoint ENI addresses.

This covered two consumers with two TGW peerings instead of four VPC peerings.
Relocating review runners to a US region was rejected because it required changing
the ARC topology. Endpoint, DNS and route changes formed one connectivity contract;
none alone established a private working path.

## Historical trade-offs

The decision estimated **$170–220/month** of standing cost for endpoints, TGWs,
peerings and traffic assumptions. This was a planning estimate, not current pricing,
a verified bill or guaranteed savings after removal. The design also added routes
to shared infrastructure owned elsewhere, increasing coordination and debugging.

ADR-009 records the reversal. Preserve this rationale without recreating the
removed stack or treating its regions/model names as current review configuration.
Use [architecture](../architecture.md) and the workflow/runner sources for the
implemented system.
