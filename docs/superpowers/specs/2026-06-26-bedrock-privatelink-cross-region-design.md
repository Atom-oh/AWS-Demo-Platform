# Cross-Region Private Bedrock Connectivity (TGW + PrivateLink)

**Date:** 2026-06-26
**Status:** Design — pending review
**Topic:** Route Bedrock traffic to `us-east-1` / `us-east-2` (`bedrock-runtime` + `bedrock-mantle`, incl. `openai.gpt-5.5`) over the AWS backbone instead of the public internet.

## Problem

The multi-AI PR review panel and interactive tooling call Amazon Bedrock cross-region:

- **Claude Opus 4.8 chair** → `bedrock-runtime.ap-northeast-2.amazonaws.com` (in-region, already private-capable).
- **Codex `openai.gpt-5.5` (bedrock-mantle, In-Region only)** → `bedrock-runtime.us-east-1.amazonaws.com` and the `bedrock-mantle` API, called from **ap-northeast-2** over the **public internet** (NAT → IGW). See `.github/workflows/pr-review.yml` (`AWS_REGION=us-east-1`, `ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com`).

Two consumer environments in ap-northeast-2 need this private:

| Consumer | VPC | CIDR | TGW attachment |
|---|---|---|---|
| Interactive EC2 (code-server / kiro / codex) | `vpc-06801144309cad7dc` (mgmt-vpc-VPC) | `10.254.0.0/16` | ✅ on `tgw-0162c7d68d7886619` |
| Self-hosted ARC runners (`mall-apne2-mgmt` EKS) | `vpc-0e1b8458f46f9f81d` (production-vpc) | `10.2.0.0/16` | ✅ on `tgw-0162c7d68d7886619` |

**Constraint that drives the design:** interface VPC endpoints (PrivateLink) are **regional**. A `com.amazonaws.us-east-1.bedrock-runtime` endpoint can only live in a us-east-1 VPC, and its "Private DNS" option only rewrites the hostname **inside the endpoint's own VPC**. The callers are in ap-northeast-2, so private cross-region access requires: (1) an endpoint VPC in each us-east region, (2) backbone connectivity from ap-northeast-2, and (3) DNS resolution of the Bedrock hostnames from the ap-northeast-2 consumer VPCs.

## Verified facts (as of 2026-06-26)

- Both endpoints exist as Interface services in both target regions:
  - `com.amazonaws.<region>.bedrock-runtime` → private DNS `bedrock-runtime.<region>.amazonaws.com`
  - `com.amazonaws.<region>.bedrock-mantle` → private DNS `bedrock-mantle.<region>.api.aws` (note: `.api.aws`, not `.amazonaws.com`)
- Both consumer VPCs are already attached to the existing ap-northeast-2 TGW `tgw-0162c7d68d7886619`.
- us-east-1 has only app/default VPCs (production-vpc `10.0.0.0/16`, StockApp `10.0.0.0/16`, default `172.31/16`); us-east-2 has only the default `172.31/16`. → dedicated endpoint VPCs will be created (no suitable existing VPC).
- No VPC peering connections currently exist in ap-northeast-2.

## Chosen approach: Transit Gateway inter-region peering

Selected over VPC peering because there are **two** consumer VPCs already attached to the existing ap-ne2 TGW. Peering would need 2 consumers × 2 regions = 4 cross-region peerings plus per-VPC route entries; TGW needs **2 inter-region peerings** total and reuses the existing TGW.

```
ap-northeast-2                                   us-east-1
  [mgmt-vpc 10.254.0.0/16]──┐                      [TGW use1]──[EP-VPC 10.60.0.0/24]
                            ├─[TGW apne2]══peer══════╯           · vpce bedrock-runtime
  [prod-vpc  10.2.0.0/16 ]──┘  (existing,            ┌──════peer═[TGW use2]──[EP-VPC 10.61.0.0/24]
        (both already         tgw-0162c7d68d7886619) │                       · vpce bedrock-runtime
         TGW-attached)                               │                       · vpce bedrock-mantle
                                                  us-east-2
```

## Components

### 1. Endpoint VPCs (us-east-1, us-east-2)
- us-east-1: `10.60.0.0/24`; us-east-2: `10.61.0.0/24`. Both non-overlapping with all known attached CIDRs (`10.2/16`, `10.254/16`, `10.0/16`, `10.20/16`, `10.42/16`, `172.31/16`).
- Private subnets only in **two AZs** each (endpoint HA). No IGW, no NAT — these VPCs only host endpoint ENIs.
- One TGW (us-east-1, us-east-2) each; endpoint VPC attached to its regional TGW.

### 2. Interface endpoints (4 total)
- us-east-1: `bedrock-runtime`, `bedrock-mantle`.
- us-east-2: `bedrock-runtime`, `bedrock-mantle`.
- **`private_dns_enabled = false`** on all four (cross-region resolution is handled by Route 53 PHZ; enabling private DNS would only affect the endpoint VPC and can conflict).
- Security group: inbound `tcp/443` from `10.2.0.0/16` and `10.254.0.0/16` only; egress none required.

### 3. Transit Gateway interconnect
- Reuse existing `tgw-0162c7d68d7886619` (ap-ne2). Create new TGWs in us-east-1 and us-east-2.
- Inter-region **TGW peering attachments**: ap-ne2 ↔ us-east-1, ap-ne2 ↔ us-east-2 (created + accepted).
- TGW route tables:
  - ap-ne2 TGW RT (associated with the two consumer attachments): static routes `10.60.0.0/24 → use1 peering`, `10.61.0.0/24 → use2 peering`.
  - us-east-1 TGW RT: `10.2.0.0/16` and `10.254.0.0/16 → ap-ne2 peering`; endpoint-VPC CIDR propagated/static for local attachment.
  - us-east-2 TGW RT: same consumer routes via ap-ne2 peering.
- Consumer **VPC subnet route tables**: *verified 2026-06-26* — they carry **specific /16** TGW routes only (mgmt-vpc RTs → `10.2.0.0/16`, prod-vpc RTs → `10.254.0.0/16`), **not** a summarized `10.0.0.0/8`. So the endpoint CIDRs are not yet routed. This module adds granular `aws_route` entries (`10.60.0.0/24` + `10.61.0.0/24` → TGW) to each consumer RT that already has a TGW route, referenced by RT ID via data source (additive, never manages the RT). Target RTs: mgmt-vpc `rtb-0f1ad80608917e523`, `rtb-0fa4472d89b98c289`; prod-vpc `rtb-02abd8443cad569e5`, `rtb-0213d02507cd872fc`, `rtb-013d8a85e36d4e35f`, `rtb-01584f9e581848e4d` (6 RTs × 2 CIDRs = 12 routes).

### 4. DNS resolution (Route 53 Private Hosted Zones)
Four PHZs, each **associated with both consumer VPCs** (`10.254` and `10.2`):
- `bedrock-runtime.us-east-1.amazonaws.com`
- `bedrock-runtime.us-east-2.amazonaws.com`
- `bedrock-mantle.us-east-1.api.aws`
- `bedrock-mantle.us-east-2.api.aws`

Each PHZ apex `A` record → the interface endpoint's ENI private IPs (resolved via `data "aws_vpc_endpoint"` → `network_interface_ids` → `aws_network_interface.private_ip`). Apex cannot be a CNAME, so A-records to the static ENI IPs are used; Terraform re-reads them on each apply so endpoint re-creation is handled.

> Effect: a caller in `10.2`/`10.254` resolving `bedrock-runtime.us-east-1.amazonaws.com` gets `10.60.0.x`, routed over the TGW backbone to the endpoint. SigV4 signing region is unchanged (still `us-east-1`).

## Data flow

1. Runner/EC2 process calls `https://bedrock-runtime.us-east-1.amazonaws.com` (unchanged app config).
2. VPC resolver consults the associated PHZ → returns `10.60.0.x` (us-east-1 endpoint ENI).
3. Packet → consumer subnet RT → ap-ne2 TGW → inter-region peering → us-east-1 TGW → endpoint VPC → interface endpoint ENI → Bedrock (private, AWS backbone).
4. `bedrock-mantle.us-east-1.api.aws` (gpt-5.5 / codex) follows the same path to the mantle endpoint.

## IaC structure

New module **`infra/bedrock-privatelink/`** (single Terraform root, three provider aliases: `apne2`, `use1`, `use2`):
- Follows repo conventions: shared backend bucket `multi-region-mall-terraform-state`, unique state key `production/aws-demo-platform/bedrock-privatelink/terraform.tfstate`, TF **1.9.8** (no `use_lockfile`; `dynamodb_table = "multi-region-mall-terraform-locks"`).
- Existing ap-ne2 TGW referenced by **ID via data source** (not managed here).
- Add a `dashboard-ecs`-style project entry to `atlantis.yaml` (`name: bedrock-privatelink`, `dir: infra/bedrock-privatelink`, autoplan on `*.tf`).
- New `infra/bedrock-privatelink/CLAUDE.md` (module hygiene rule).

## Error handling / failure modes

- **TGW route conflict / ownership:** *Resolved (2026-06-26 investigation).* `atom-tgw` (`tgw-0162c7d68d7886619`) is in-account (180294183052), minimally tagged (`Name=atom-tgw`), and **not managed by this repo's Terraform** (zero TGW resources in repo). Its default route table `tgw-rtb-019c5cb46f743be38` carries `10.2.0.0/16` + `10.254.0.0/16` (propagated) and a manual `172.16.0.0/16` blackhole (evidence of out-of-band/console route management). `10.60.0.0/24` / `10.61.0.0/24` are absent → additive, no conflict. Mitigation: this module **references the TGW + default RT by data source only** (never manages the TGW, its existing attachments, or existing routes); it adds only the 2 peering attachments + 2 static routes. Because routes are managed out-of-band, run `atlantis plan` before apply to confirm no drift.
- **PHZ shadowing:** a PHZ for `bedrock-runtime.us-east-1.amazonaws.com` overrides that exact name in associated VPCs only; ap-ne2 in-region Bedrock (`bedrock-runtime.ap-northeast-2.amazonaws.com`) is untouched.
- **Endpoint ENI IP churn:** handled by re-reading via data source each apply; A-records updated by Terraform.
- **Partial failure:** if DNS resolves but routing is missing, calls time out (not 4xx). Validation step (below) catches this before relying on it.
- **Fallback:** until cutover is validated, public path still works (PHZ is additive); rollback = remove PHZ associations to revert to public DNS.

## Testing / validation

Validate from **this EC2 instance** (`10.254.22.82`, mgmt-vpc) and from a runner pod:
1. `dig +short bedrock-runtime.us-east-1.amazonaws.com` → expect `10.60.0.x` (not public IP).
2. `dig +short bedrock-mantle.us-east-1.api.aws` → expect `10.60.0.x`.
3. Live call: `aws bedrock-runtime list-foundation-models` style probe / a minimal `InvokeModel` against us-east-1 succeeds.
4. Repeat for us-east-2 (`10.61.0.x`).
5. From a runner pod (production-vpc): same `dig` + a `codex`/gpt-5.5 invocation through `pr-review` path.
6. (Optional hardening, follow-up) Confirm public egress is no longer used — e.g., VPC Flow Logs show no NAT→Bedrock public traffic.

## Cost (order-of-magnitude — verify before apply)

- 4 interface endpoints × 2 AZ ENIs ≈ 8 ENI-hours (~$0.01/hr) ≈ **~$60/mo** + $0.01/GB processing.
- 2 new TGWs + 2 endpoint-VPC attachments + 2 inter-region peering attachments (~$0.05/hr each) ≈ **~$110–150/mo** + $0.02/GB TGW data + cross-region transfer.
- Rough standing total **~$170–220/mo** for low CI volume. Confirm with AWS Pricing before apply.

## Out of scope / follow-ups

- Blocking the public Bedrock egress path at the SG/NAT level (separate hardening PR).
- Extending to additional regions or consumer VPCs (TGW makes this incremental).
- ADR documenting TGW-vs-peering decision (create during implementation per repo Auto-Sync rules).

## Open questions for reviewer

1. ~~TGW route-table ownership~~ — **Resolved** (see Error handling): in-account, unmanaged-by-repo, additive routes only.
2. AZ choice for endpoint VPC subnets (pick 2 AZs per region — `use1-az1/az2`, `use2-az1/az2`).
3. Accept the ~$170–220/mo standing cost for CI-only egress privacy, or scope to us-east-1 first?

## TGW facts (verified 2026-06-26)

- `atom-tgw` `tgw-0162c7d68d7886619`, owner `180294183052`, ASN 64512, default RT association + propagation enabled.
- Default RT `tgw-rtb-019c5cb46f743be38`: `10.2.0.0/16` (→ production-vpc, propagated), `10.254.0.0/16` (→ mgmt-vpc, propagated), `172.16.0.0/16` (static blackhole). Second RT `tgw-rtb-0d2526e121b005499` (`Name=test`, non-default, unused for consumers).
- Not present in repo Terraform → reference by data source, add-only.
