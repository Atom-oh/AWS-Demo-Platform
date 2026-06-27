# Cross-Region Private Bedrock Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route ap-northeast-2 Bedrock traffic to `us-east-1`/`us-east-2` `bedrock-runtime` + `bedrock-mantle` (incl. `openai.gpt-5.5`) over the AWS backbone via Transit Gateway + PrivateLink instead of the public internet.

**Architecture:** New Terraform module `infra/bedrock-privatelink/` (3 provider aliases: apne2/use1/use2) creates dedicated endpoint VPCs in each us-east region with `bedrock-runtime` + `bedrock-mantle` interface endpoints, connects them to the two existing ap-ne2 consumer VPCs through the existing TGW `tgw-0162c7d68d7886619` via inter-region TGW peering, and resolves the Bedrock hostnames cross-region with Route 53 Private Hosted Zones associated to both consumer VPCs. The module references all pre-existing resources (TGW, default RT, consumer VPCs/RTs) by data source and only **adds** resources/routes.

**Tech Stack:** Terraform `>= 1.9` (repo pins 1.9.8), AWS provider `>= 6.0`, S3 backend `multi-region-mall-terraform-state` + DynamoDB lock `multi-region-mall-terraform-locks`, Atlantis for plan/apply, Route 53 PHZ, EC2 Transit Gateway.

**Spec:** `docs/superpowers/specs/2026-06-26-bedrock-privatelink-cross-region-design.md`

## Global Constraints

- Terraform `required_version = ">= 1.9"`; AWS provider `version = ">= 6.0"`. Do NOT use `use_lockfile` (TF 1.10+); use `dynamodb_table = "multi-region-mall-terraform-locks"`.
- Backend bucket `multi-region-mall-terraform-state`, `region = "us-east-1"`, `encrypt = true`, state key `production/aws-demo-platform/bedrock-privatelink/terraform.tfstate`.
- `default_tags` on every provider: `Project=aws-demo-platform`, `Component=bedrock-privatelink`, `ManagedBy=terraform`, `Environment=dev`.
- Resource naming prefix `demo-platform-`. Module references existing TGW/VPCs/RTs by **data source only** — never manage them.
- All four interface endpoints set `private_dns_enabled = false` (cross-region DNS handled by PHZ).
- Endpoint VPC CIDRs: us-east-1 `10.60.0.0/24`, us-east-2 `10.61.0.0/24` (verified non-overlapping with `10.2/16`, `10.254/16`, `10.0/16`, `10.20/16`, `10.42/16`, `172.31/16`, `172.16/16`).
- Terraform changes flow through Atlantis (PR comment `atlantis plan`/`atlantis apply`), never local apply.
- Per-task local verification: `terraform fmt -check` + `terraform init -backend=false` + `terraform validate` (real plan happens via Atlantis in Task 12).

## Verified facts (baked in — do not re-discover)

- Existing TGW: `tgw-0162c7d68d7886619` (`atom-tgw`), account `180294183052`, ASN 64512, default RT assoc + propagation enabled. Default RT `tgw-rtb-019c5cb46f743be38` (routes: `10.2.0.0/16`, `10.254.0.0/16` propagated, `172.16.0.0/16` blackhole). Not managed by repo TF.
- Consumer VPCs: mgmt-vpc `vpc-06801144309cad7dc` (`10.254.0.0/16`), production-vpc `vpc-0e1b8458f46f9f81d` (`10.2.0.0/16`). Both already TGW-attached.
- Consumer subnet RTs needing endpoint-CIDR routes (already have a TGW route): mgmt-vpc `rtb-0f1ad80608917e523`, `rtb-0fa4472d89b98c289`; prod-vpc `rtb-02abd8443cad569e5`, `rtb-0213d02507cd872fc`, `rtb-013d8a85e36d4e35f`, `rtb-01584f9e581848e4d`.
- Endpoint service names: `com.amazonaws.<r>.bedrock-runtime` (DNS `bedrock-runtime.<r>.amazonaws.com`), `com.amazonaws.<r>.bedrock-mantle` (DNS `bedrock-mantle.<r>.api.aws`).
- Endpoint VPC subnet AZs: us-east-1 → `us-east-1a`,`us-east-1b`; us-east-2 → `us-east-2a`,`us-east-2b`.

---

### Task 1: Module scaffold (backend, providers, versions, locals, CLAUDE.md)

**Files:**
- Create: `infra/bedrock-privatelink/versions.tf`
- Create: `infra/bedrock-privatelink/providers.tf`
- Create: `infra/bedrock-privatelink/locals.tf`
- Create: `infra/bedrock-privatelink/CLAUDE.md`

**Interfaces:**
- Produces: provider aliases `aws.apne2`, `aws.use1`, `aws.use2`; `local.endpoint_vpc_cidr = { use1 = "10.60.0.0/24", use2 = "10.61.0.0/24" }`; `local.consumer_vpc_ids = ["vpc-06801144309cad7dc","vpc-0e1b8458f46f9f81d"]`; `local.consumer_route_table_ids = ["rtb-0f1ad80608917e523","rtb-0fa4472d89b98c289","rtb-02abd8443cad569e5","rtb-0213d02507cd872fc","rtb-013d8a85e36d4e35f","rtb-01584f9e581848e4d"]`; `local.existing_tgw_id = "tgw-0162c7d68d7886619"`; `local.existing_tgw_rt_id = "tgw-rtb-019c5cb46f743be38"`.

- [ ] **Step 1: Write `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
  backend "s3" {
    bucket         = "multi-region-mall-terraform-state"
    key            = "production/aws-demo-platform/bedrock-privatelink/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "multi-region-mall-terraform-locks"
  }
}
```

- [ ] **Step 2: Write `providers.tf`** (three aliased providers)

```hcl
locals {
  default_tags = {
    Project     = "aws-demo-platform"
    Component   = "bedrock-privatelink"
    ManagedBy   = "terraform"
    Environment = "dev"
  }
}

provider "aws" {
  alias  = "apne2"
  region = "ap-northeast-2"
  default_tags { tags = local.default_tags }
}

provider "aws" {
  alias  = "use1"
  region = "us-east-1"
  default_tags { tags = local.default_tags }
}

provider "aws" {
  alias  = "use2"
  region = "us-east-2"
  default_tags { tags = local.default_tags }
}
```

- [ ] **Step 3: Write `locals.tf`** (baked identifiers from verified facts)

```hcl
locals {
  existing_tgw_id    = "tgw-0162c7d68d7886619"
  existing_tgw_rt_id = "tgw-rtb-019c5cb46f743be38"

  consumer_vpc_ids = [
    "vpc-06801144309cad7dc", # mgmt-vpc   10.254.0.0/16
    "vpc-0e1b8458f46f9f81d", # prod-vpc   10.2.0.0/16
  ]
  consumer_cidrs = ["10.254.0.0/16", "10.2.0.0/16"]

  # Consumer subnet route tables that already route to the TGW (need endpoint-CIDR routes)
  consumer_route_table_ids = [
    "rtb-0f1ad80608917e523", "rtb-0fa4472d89b98c289",                       # mgmt-vpc
    "rtb-02abd8443cad569e5", "rtb-0213d02507cd872fc",
    "rtb-013d8a85e36d4e35f", "rtb-01584f9e581848e4d",                       # prod-vpc
  ]

  endpoint_vpc_cidr = { use1 = "10.60.0.0/24", use2 = "10.61.0.0/24" }
  endpoint_subnets = {
    use1 = { a = "10.60.0.0/26", b = "10.60.0.64/26" }
    use2 = { a = "10.61.0.0/26", b = "10.61.0.64/26" }
  }
  endpoint_azs = {
    use1 = ["us-east-1a", "us-east-1b"]
    use2 = ["us-east-2a", "us-east-2b"]
  }
}
```

- [ ] **Step 4: Write `CLAUDE.md`** (module hygiene per repo rule)

```markdown
# infra/bedrock-privatelink

Cross-region private Bedrock connectivity. Routes ap-northeast-2 consumer VPCs
(mgmt-vpc 10.254/16, prod-vpc 10.2/16) to us-east-1/us-east-2 `bedrock-runtime`
+ `bedrock-mantle` interface endpoints over the AWS backbone via the existing
TGW `tgw-0162c7d68d7886619` + inter-region TGW peering. Endpoint VPCs 10.60.0.0/24
(use1) / 10.61.0.0/24 (use2). Cross-region DNS via Route 53 PHZ associated to both
consumer VPCs.

- **State key**: `production/aws-demo-platform/bedrock-privatelink/terraform.tfstate`
- **Providers**: aliases `apne2` / `use1` / `use2`.
- **Add-only**: TGW, its default RT, consumer VPCs and their subnet RTs are referenced
  by data source and never managed here — only routes/attachments/PHZs are added.
- Design: `docs/superpowers/specs/2026-06-26-bedrock-privatelink-cross-region-design.md`.
- Apply via Atlantis: `atlantis plan -d infra/bedrock-privatelink` then `atlantis apply -d infra/bedrock-privatelink`.
```

- [ ] **Step 5: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.` (no resources yet, providers parse)

- [ ] **Step 6: Commit**

```bash
git add infra/bedrock-privatelink/
git commit -m "feat(bedrock-privatelink): module scaffold (providers, locals, CLAUDE.md)"
```

---

### Task 2: Data sources for existing resources

**Files:**
- Create: `infra/bedrock-privatelink/data.tf`

**Interfaces:**
- Consumes: `local.*` from Task 1.
- Produces: `data.aws_vpc_endpoint_service.runtime["use1"|"use2"]`, `...mantle[...]` (for SG/endpoint wiring is not needed — service names are static, but AZ data is). `data.aws_caller_identity.current`; `data.aws_region` per alias.

- [ ] **Step 1: Write `data.tf`**

```hcl
data "aws_caller_identity" "current" {
  provider = aws.apne2
}

# Region handles (for peering attachment cross-region wiring)
data "aws_region" "use1" { provider = aws.use1 }
data "aws_region" "use2" { provider = aws.use2 }
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/data.tf
git commit -m "feat(bedrock-privatelink): data sources for account/region"
```

---

### Task 3: Endpoint VPC — us-east-1

**Files:**
- Create: `infra/bedrock-privatelink/vpc-use1.tf`

**Interfaces:**
- Consumes: `local.endpoint_vpc_cidr.use1`, `local.endpoint_subnets.use1`, `local.endpoint_azs.use1`.
- Produces: `aws_vpc.use1`, `aws_subnet.use1["a"|"b"]`, `aws_route_table.use1`, `aws_security_group.ep_use1`.

- [ ] **Step 1: Write `vpc-use1.tf`**

```hcl
resource "aws_vpc" "use1" {
  provider             = aws.use1
  cidr_block           = local.endpoint_vpc_cidr.use1
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "demo-platform-bedrock-ep-use1" }
}

resource "aws_subnet" "use1" {
  provider          = aws.use1
  for_each          = local.endpoint_subnets.use1
  vpc_id            = aws_vpc.use1.id
  cidr_block        = each.value
  availability_zone = each.key == "a" ? local.endpoint_azs.use1[0] : local.endpoint_azs.use1[1]
  tags              = { Name = "demo-platform-bedrock-ep-use1-${each.key}" }
}

resource "aws_route_table" "use1" {
  provider = aws.use1
  vpc_id   = aws_vpc.use1.id
  tags     = { Name = "demo-platform-bedrock-ep-use1" }
}

resource "aws_route_table_association" "use1" {
  provider       = aws.use1
  for_each       = aws_subnet.use1
  subnet_id      = each.value.id
  route_table_id = aws_route_table.use1.id
}

# Return path to ap-ne2 consumers via the regional TGW (added in Task 8 as a route).
resource "aws_security_group" "ep_use1" {
  provider    = aws.use1
  name        = "demo-platform-bedrock-ep-use1"
  description = "Allow 443 from ap-ne2 consumer VPCs to Bedrock interface endpoints"
  vpc_id      = aws_vpc.use1.id

  ingress {
    description = "HTTPS from consumer VPCs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.consumer_cidrs
  }
  tags = { Name = "demo-platform-bedrock-ep-use1" }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/vpc-use1.tf
git commit -m "feat(bedrock-privatelink): us-east-1 endpoint VPC, subnets, SG"
```

---

### Task 4: Endpoint VPC — us-east-2

**Files:**
- Create: `infra/bedrock-privatelink/vpc-use2.tf`

**Interfaces:**
- Produces: `aws_vpc.use2`, `aws_subnet.use2["a"|"b"]`, `aws_route_table.use2`, `aws_security_group.ep_use2`.

- [ ] **Step 1: Write `vpc-use2.tf`** (identical shape to Task 3 with `use2` provider/locals; full code below — do not abbreviate)

```hcl
resource "aws_vpc" "use2" {
  provider             = aws.use2
  cidr_block           = local.endpoint_vpc_cidr.use2
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "demo-platform-bedrock-ep-use2" }
}

resource "aws_subnet" "use2" {
  provider          = aws.use2
  for_each          = local.endpoint_subnets.use2
  vpc_id            = aws_vpc.use2.id
  cidr_block        = each.value
  availability_zone = each.key == "a" ? local.endpoint_azs.use2[0] : local.endpoint_azs.use2[1]
  tags              = { Name = "demo-platform-bedrock-ep-use2-${each.key}" }
}

resource "aws_route_table" "use2" {
  provider = aws.use2
  vpc_id   = aws_vpc.use2.id
  tags     = { Name = "demo-platform-bedrock-ep-use2" }
}

resource "aws_route_table_association" "use2" {
  provider       = aws.use2
  for_each       = aws_subnet.use2
  subnet_id      = each.value.id
  route_table_id = aws_route_table.use2.id
}

resource "aws_security_group" "ep_use2" {
  provider    = aws.use2
  name        = "demo-platform-bedrock-ep-use2"
  description = "Allow 443 from ap-ne2 consumer VPCs to Bedrock interface endpoints"
  vpc_id      = aws_vpc.use2.id

  ingress {
    description = "HTTPS from consumer VPCs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = local.consumer_cidrs
  }
  tags = { Name = "demo-platform-bedrock-ep-use2" }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/vpc-use2.tf
git commit -m "feat(bedrock-privatelink): us-east-2 endpoint VPC, subnets, SG"
```

---

### Task 5: Interface endpoints (bedrock-runtime + bedrock-mantle × 2 regions)

**Files:**
- Create: `infra/bedrock-privatelink/endpoints.tf`

**Interfaces:**
- Consumes: `aws_vpc.use1/use2`, `aws_subnet.use1/use2`, `aws_security_group.ep_use1/ep_use2`.
- Produces: `aws_vpc_endpoint.use1_runtime`, `aws_vpc_endpoint.use1_mantle`, `aws_vpc_endpoint.use2_runtime`, `aws_vpc_endpoint.use2_mantle` (each exposes `.network_interface_ids`).

- [ ] **Step 1: Write `endpoints.tf`**

```hcl
# us-east-1
resource "aws_vpc_endpoint" "use1_runtime" {
  provider            = aws.use1
  vpc_id              = aws_vpc.use1.id
  service_name        = "com.amazonaws.us-east-1.bedrock-runtime"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.use1 : s.id]
  security_group_ids  = [aws_security_group.ep_use1.id]
  private_dns_enabled = false
  tags                = { Name = "demo-platform-bedrock-runtime-use1" }
}

resource "aws_vpc_endpoint" "use1_mantle" {
  provider            = aws.use1
  vpc_id              = aws_vpc.use1.id
  service_name        = "com.amazonaws.us-east-1.bedrock-mantle"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.use1 : s.id]
  security_group_ids  = [aws_security_group.ep_use1.id]
  private_dns_enabled = false
  tags                = { Name = "demo-platform-bedrock-mantle-use1" }
}

# us-east-2
resource "aws_vpc_endpoint" "use2_runtime" {
  provider            = aws.use2
  vpc_id              = aws_vpc.use2.id
  service_name        = "com.amazonaws.us-east-2.bedrock-runtime"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.use2 : s.id]
  security_group_ids  = [aws_security_group.ep_use2.id]
  private_dns_enabled = false
  tags                = { Name = "demo-platform-bedrock-runtime-use2" }
}

resource "aws_vpc_endpoint" "use2_mantle" {
  provider            = aws.use2
  vpc_id              = aws_vpc.use2.id
  service_name        = "com.amazonaws.us-east-2.bedrock-mantle"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for s in aws_subnet.use2 : s.id]
  security_group_ids  = [aws_security_group.ep_use2.id]
  private_dns_enabled = false
  tags                = { Name = "demo-platform-bedrock-mantle-use2" }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/endpoints.tf
git commit -m "feat(bedrock-privatelink): bedrock-runtime + bedrock-mantle interface endpoints (use1/use2)"
```

---

### Task 6: us-east Transit Gateways + endpoint-VPC attachments

**Files:**
- Create: `infra/bedrock-privatelink/tgw.tf`

**Interfaces:**
- Consumes: `aws_vpc.use1/use2`, `aws_subnet.use1/use2`.
- Produces: `aws_ec2_transit_gateway.use1`, `aws_ec2_transit_gateway.use2`, `aws_ec2_transit_gateway_vpc_attachment.use1`, `...use2` (each has `.id` and an auto-created default RT referenced via `.association_default_route_table_id`).

- [ ] **Step 1: Write the TGW + attachment block in `tgw.tf`**

```hcl
resource "aws_ec2_transit_gateway" "use1" {
  provider                        = aws.use1
  description                     = "demo-platform bedrock endpoints (us-east-1)"
  amazon_side_asn                 = 64513
  default_route_table_association = "enable"
  default_route_table_propagation = "enable"
  tags                            = { Name = "demo-platform-bedrock-tgw-use1" }
}

resource "aws_ec2_transit_gateway" "use2" {
  provider                        = aws.use2
  description                     = "demo-platform bedrock endpoints (us-east-2)"
  amazon_side_asn                 = 64514
  default_route_table_association = "enable"
  default_route_table_propagation = "enable"
  tags                            = { Name = "demo-platform-bedrock-tgw-use2" }
}

resource "aws_ec2_transit_gateway_vpc_attachment" "use1" {
  provider           = aws.use1
  transit_gateway_id = aws_ec2_transit_gateway.use1.id
  vpc_id             = aws_vpc.use1.id
  subnet_ids         = [for s in aws_subnet.use1 : s.id]
  tags               = { Name = "demo-platform-bedrock-ep-use1" }
}

resource "aws_ec2_transit_gateway_vpc_attachment" "use2" {
  provider           = aws.use2
  transit_gateway_id = aws_ec2_transit_gateway.use2.id
  vpc_id             = aws_vpc.use2.id
  subnet_ids         = [for s in aws_subnet.use2 : s.id]
  tags               = { Name = "demo-platform-bedrock-ep-use2" }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/tgw.tf
git commit -m "feat(bedrock-privatelink): us-east TGWs + endpoint VPC attachments"
```

---

### Task 7: Inter-region TGW peering (apne2 ↔ use1, apne2 ↔ use2)

**Files:**
- Modify: `infra/bedrock-privatelink/tgw.tf` (append)

**Interfaces:**
- Consumes: `local.existing_tgw_id`, `aws_ec2_transit_gateway.use1/use2`, `data.aws_caller_identity.current`, `data.aws_region.use1/use2`.
- Produces: `aws_ec2_transit_gateway_peering_attachment.use1`, `...use2` (requester side, provider apne2); `aws_ec2_transit_gateway_peering_attachment_accepter.use1`, `...use2` (accepter side).

- [ ] **Step 1: Append peering resources to `tgw.tf`**

```hcl
# Requester: existing ap-ne2 TGW initiates peering to each us-east TGW
resource "aws_ec2_transit_gateway_peering_attachment" "use1" {
  provider                = aws.apne2
  transit_gateway_id      = local.existing_tgw_id
  peer_transit_gateway_id = aws_ec2_transit_gateway.use1.id
  peer_account_id         = data.aws_caller_identity.current.account_id
  peer_region             = data.aws_region.use1.name
  tags                    = { Name = "demo-platform-bedrock-peer-apne2-use1" }
}

resource "aws_ec2_transit_gateway_peering_attachment_accepter" "use1" {
  provider                      = aws.use1
  transit_gateway_attachment_id = aws_ec2_transit_gateway_peering_attachment.use1.id
  tags                          = { Name = "demo-platform-bedrock-peer-apne2-use1" }
}

resource "aws_ec2_transit_gateway_peering_attachment" "use2" {
  provider                = aws.apne2
  transit_gateway_id      = local.existing_tgw_id
  peer_transit_gateway_id = aws_ec2_transit_gateway.use2.id
  peer_account_id         = data.aws_caller_identity.current.account_id
  peer_region             = data.aws_region.use2.name
  tags                    = { Name = "demo-platform-bedrock-peer-apne2-use2" }
}

resource "aws_ec2_transit_gateway_peering_attachment_accepter" "use2" {
  provider                      = aws.use2
  transit_gateway_attachment_id = aws_ec2_transit_gateway_peering_attachment.use2.id
  tags                          = { Name = "demo-platform-bedrock-peer-apne2-use2" }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/tgw.tf
git commit -m "feat(bedrock-privatelink): inter-region TGW peering (apne2<->use1/use2)"
```

---

### Task 8: TGW routes + peering route-table associations

**Files:**
- Create: `infra/bedrock-privatelink/tgw-routes.tf`

**Interfaces:**
- Consumes: `local.existing_tgw_rt_id`, peering attachments (Task 7), us-east TGWs (Task 6), `local.endpoint_vpc_cidr`, `local.consumer_cidrs`.
- Produces: routes on the ap-ne2 default RT toward us-east; routes on each us-east TGW RT back to consumers; peering-attachment associations on both sides.

**Why associations:** TGW peering attachments do not propagate; each must be associated to a route table and the destination routes added statically.

- [ ] **Step 1: Write `tgw-routes.tf`**

```hcl
# --- ap-ne2 side: existing default RT -> us-east endpoint CIDRs via peering ---
resource "aws_ec2_transit_gateway_route_table_association" "apne2_use1" {
  provider                       = aws.apne2
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use1.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id
}

resource "aws_ec2_transit_gateway_route_table_association" "apne2_use2" {
  provider                       = aws.apne2
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use2.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id
}

resource "aws_ec2_transit_gateway_route" "apne2_to_use1" {
  provider                       = aws.apne2
  destination_cidr_block         = local.endpoint_vpc_cidr.use1
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use1.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id
}

resource "aws_ec2_transit_gateway_route" "apne2_to_use2" {
  provider                       = aws.apne2
  destination_cidr_block         = local.endpoint_vpc_cidr.use2
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use2.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id
}

# --- us-east-1 side: peering attachment association + routes back to consumers ---
resource "aws_ec2_transit_gateway_route_table_association" "use1_peer" {
  provider                       = aws.use1
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use1.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use1.association_default_route_table_id
}

resource "aws_ec2_transit_gateway_route" "use1_to_consumers" {
  provider                       = aws.use1
  for_each                       = toset(local.consumer_cidrs)
  destination_cidr_block         = each.value
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use1.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use1.association_default_route_table_id
}

# --- us-east-2 side ---
resource "aws_ec2_transit_gateway_route_table_association" "use2_peer" {
  provider                       = aws.use2
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use2.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use2.association_default_route_table_id
}

resource "aws_ec2_transit_gateway_route" "use2_to_consumers" {
  provider                       = aws.use2
  for_each                       = toset(local.consumer_cidrs)
  destination_cidr_block         = each.value
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use2.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use2.association_default_route_table_id
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/tgw-routes.tf
git commit -m "feat(bedrock-privatelink): TGW peering associations + cross-region routes"
```

---

### Task 9: Consumer VPC subnet routes to endpoint VPCs

**Files:**
- Create: `infra/bedrock-privatelink/consumer-routes.tf`

**Interfaces:**
- Consumes: `local.consumer_route_table_ids`, `local.existing_tgw_id`, `local.endpoint_vpc_cidr`.
- Produces: 12 `aws_route` entries (6 RTs × 2 endpoint CIDRs) → existing TGW.

**Note:** `aws_route` is granular and additive; it does not manage the route table, so it coexists with the RT's owning stack as long as the destination CIDR is unique (verified absent).

- [ ] **Step 1: Write `consumer-routes.tf`**

```hcl
locals {
  consumer_route_pairs = {
    for pair in setproduct(local.consumer_route_table_ids, values(local.endpoint_vpc_cidr)) :
    "${pair[0]}_${pair[1]}" => { rt = pair[0], cidr = pair[1] }
  }
}

resource "aws_route" "consumer_to_endpoints" {
  provider               = aws.apne2
  for_each               = local.consumer_route_pairs
  route_table_id         = each.value.rt
  destination_cidr_block = each.value.cidr
  transit_gateway_id     = local.existing_tgw_id
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/consumer-routes.tf
git commit -m "feat(bedrock-privatelink): consumer subnet routes to endpoint VPCs via TGW"
```

---

### Task 10: Cross-region DNS (Route 53 Private Hosted Zones)

**Files:**
- Create: `infra/bedrock-privatelink/dns.tf`

**Interfaces:**
- Consumes: the four `aws_vpc_endpoint` resources, `local.consumer_vpc_ids`.
- Produces: 4 `aws_route53_zone` (PHZ), each associated to the first consumer VPC at creation + extra `aws_route53_zone_association` for the second; one apex `A` record per zone pointing to the endpoint ENI private IPs.

**ENI IP lookup:** each interface endpoint exposes `network_interface_ids`; read each ENI's `private_ip` via `aws_network_interface` data sources and build the A-record records list.

- [ ] **Step 1: Write `dns.tf`**

```hcl
# Resolve endpoint ENI private IPs (provider must match each endpoint's region)
data "aws_network_interface" "use1_runtime" {
  provider = aws.use1
  for_each = toset(aws_vpc_endpoint.use1_runtime.network_interface_ids)
  id       = each.value
}
data "aws_network_interface" "use1_mantle" {
  provider = aws.use1
  for_each = toset(aws_vpc_endpoint.use1_mantle.network_interface_ids)
  id       = each.value
}
data "aws_network_interface" "use2_runtime" {
  provider = aws.use2
  for_each = toset(aws_vpc_endpoint.use2_runtime.network_interface_ids)
  id       = each.value
}
data "aws_network_interface" "use2_mantle" {
  provider = aws.use2
  for_each = toset(aws_vpc_endpoint.use2_mantle.network_interface_ids)
  id       = each.value
}

locals {
  phz = {
    use1_runtime = { zone = "bedrock-runtime.us-east-1.amazonaws.com", ips = [for n in data.aws_network_interface.use1_runtime : n.private_ip] }
    use1_mantle  = { zone = "bedrock-mantle.us-east-1.api.aws", ips = [for n in data.aws_network_interface.use1_mantle : n.private_ip] }
    use2_runtime = { zone = "bedrock-runtime.us-east-2.amazonaws.com", ips = [for n in data.aws_network_interface.use2_runtime : n.private_ip] }
    use2_mantle  = { zone = "bedrock-mantle.us-east-2.api.aws", ips = [for n in data.aws_network_interface.use2_mantle : n.private_ip] }
  }
}

resource "aws_route53_zone" "this" {
  provider = aws.apne2
  for_each = local.phz
  name     = each.value.zone
  vpc {
    vpc_id     = local.consumer_vpc_ids[0]
    vpc_region = "ap-northeast-2"
  }
  # Prevent Terraform from fighting the second association added below.
  lifecycle { ignore_changes = [vpc] }
  tags = { Name = "demo-platform-${each.key}" }
}

resource "aws_route53_zone_association" "second" {
  provider = aws.apne2
  for_each = local.phz
  zone_id  = aws_route53_zone.this[each.key].zone_id
  vpc_id   = local.consumer_vpc_ids[1]
}

resource "aws_route53_record" "apex" {
  provider = aws.apne2
  for_each = local.phz
  zone_id  = aws_route53_zone.this[each.key].zone_id
  name     = each.value.zone
  type     = "A"
  ttl      = 300
  records  = each.value.ips
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/dns.tf
git commit -m "feat(bedrock-privatelink): Route53 PHZs for cross-region Bedrock DNS"
```

---

### Task 11: Outputs

**Files:**
- Create: `infra/bedrock-privatelink/outputs.tf`

**Interfaces:**
- Produces: human-verifiable outputs for the post-apply validation in Task 13.

- [ ] **Step 1: Write `outputs.tf`**

```hcl
output "endpoint_vpc_ids" {
  value = { use1 = aws_vpc.use1.id, use2 = aws_vpc.use2.id }
}

output "bedrock_runtime_ips" {
  description = "Private IPs the PHZ resolves bedrock-runtime to (per region)"
  value = {
    use1 = local.phz.use1_runtime.ips
    use2 = local.phz.use2_runtime.ips
  }
}

output "bedrock_mantle_ips" {
  value = {
    use1 = local.phz.use1_mantle.ips
    use2 = local.phz.use2_mantle.ips
  }
}

output "tgw_peering_attachment_ids" {
  value = {
    use1 = aws_ec2_transit_gateway_peering_attachment.use1.id
    use2 = aws_ec2_transit_gateway_peering_attachment.use2.id
  }
}
```

- [ ] **Step 2: Validate**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/bedrock-privatelink/outputs.tf
git commit -m "feat(bedrock-privatelink): outputs for post-apply verification"
```

---

### Task 12: Atlantis project entry + docs sync (architecture.md, ADR-008)

**Files:**
- Modify: `atlantis.yaml` (append a project)
- Modify: `docs/architecture.md` (Infrastructure table + GitOps/network section)
- Create: `docs/decisions/ADR-008-cross-region-bedrock-privatelink.md`

**Interfaces:** none (config/docs).

- [ ] **Step 1: Append the Atlantis project** (match the `dashboard-ecs` block style; place after the last `- name:` project)

```yaml
  - name: bedrock-privatelink
    dir: infra/bedrock-privatelink
    terraform_version: v1.9.8
    autoplan:
      enabled: true
      when_modified:
        - "*.tf"
        - "../../atlantis.yaml"
```

- [ ] **Step 2: Add an Infrastructure-table row in `docs/architecture.md`**

Add (matching the existing table format):

```markdown
| `infra/bedrock-privatelink/` | Cross-region private Bedrock access: us-east-1/us-east-2 `bedrock-runtime`+`bedrock-mantle` interface endpoints reached from ap-ne2 consumer VPCs via existing TGW + inter-region peering + Route53 PHZ ([ADR-008](decisions/ADR-008-cross-region-bedrock-privatelink.md)) |
```

- [ ] **Step 3: Write `docs/decisions/ADR-008-cross-region-bedrock-privatelink.md`**

```markdown
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
```

- [ ] **Step 4: Validate atlantis.yaml + docs**

Run: `cd infra/bedrock-privatelink && terraform fmt -check && terraform validate` (still valid) and `python3 -c "import yaml;yaml.safe_load(open('../../atlantis.yaml'))"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add atlantis.yaml docs/architecture.md docs/decisions/ADR-008-cross-region-bedrock-privatelink.md
git commit -m "chore(bedrock-privatelink): Atlantis project + docs sync (ADR-008, architecture)"
```

---

### Task 13: PR, Atlantis plan/apply, and live verification

**Files:** none (operational).

**This is the integration test.** Local `terraform validate` cannot exercise real state, cross-region peering, or DNS — Atlantis plan + live probes do.

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin <branch>
gh pr create --base main --title "feat: cross-region private Bedrock connectivity (TGW + PrivateLink)" --body "<summary + link to spec/ADR-008; note add-only TGW/consumer-RT routes>"
```

- [ ] **Step 2: Atlantis plan — confirm add-only**

In the PR comment: `atlantis plan -d infra/bedrock-privatelink`
Expected: plan **adds** ~VPCs(2), subnets(4), endpoints(4), SGs(2), TGWs(2), attachments(2), peerings(2)+accepters(2), TGW routes/associations, 12 consumer `aws_route`, 4 PHZ + 4 records. **Zero destroy/replace of existing resources** (verify no changes to the existing TGW, its RT, or consumer RTs themselves). If any existing resource shows modify/destroy, STOP and investigate ownership.

- [ ] **Step 3: Atlantis apply**

In the PR comment: `atlantis apply -d infra/bedrock-privatelink`
Expected: apply complete; note the `bedrock_runtime_ips` / `bedrock_mantle_ips` outputs.

- [ ] **Step 4: Verify DNS from this EC2 (mgmt-vpc, 10.254)**

```bash
dig +short bedrock-runtime.us-east-1.amazonaws.com   # expect 10.60.0.x (matches output)
dig +short bedrock-mantle.us-east-1.api.aws          # expect 10.60.0.x
dig +short bedrock-runtime.us-east-2.amazonaws.com   # expect 10.61.0.x
dig +short bedrock-mantle.us-east-2.api.aws          # expect 10.61.0.x
```
Expected: private IPs (not public). If public IPs return, the PHZ association did not take — recheck `aws_route53_zone_association`.

- [ ] **Step 5: Verify a live Bedrock call traverses the private path (us-east-1)**

```bash
AWS_REGION=us-east-1 aws bedrock-runtime invoke-model \
  --model-id <an available us-east-1 model id> \
  --body '{"...minimal..."}' --cli-binary-format raw-in-base64-out /tmp/out.json && echo OK
```
Expected: success (200/body written). A timeout indicates a routing gap (TGW route or consumer route missing).

- [ ] **Step 6: Verify from a runner pod (production-vpc, 10.2)**

```bash
kubectl --context mall-apne2-mgmt -n actions-runner-system exec <a runner pod> -- \
  sh -c 'getent hosts bedrock-runtime.us-east-1.amazonaws.com; getent hosts bedrock-mantle.us-east-1.api.aws'
```
Expected: 10.60.0.x for both. Then trigger a PR-review run and confirm the codex/gpt-5.5 step succeeds.

- [ ] **Step 7: Merge**

After verification passes, merge the PR (apply already ran). Confirm `atlantis plan` shows "No changes" if re-run.

---

## Notes for the implementer

- **Provider blocks for peering accepter:** the accepter resource lives in the peer region (`aws.use1`/`aws.use2`); the requester in `aws.apne2`. Cross-region peering attachments can take a few minutes to reach `available` — Atlantis apply handles the wait.
- **PHZ shadowing is intentional and scoped:** the zone `bedrock-runtime.us-east-1.amazonaws.com` only overrides resolution inside the two associated consumer VPCs. The in-region ap-ne2 endpoint (`bedrock-runtime.ap-northeast-2.amazonaws.com`) is untouched.
- **If `atlantis plan` shows a modify/destroy on any pre-existing resource:** do not apply. The module is designed add-only; investigate before proceeding.
- **Cost gate:** if the reviewer wants to scope to us-east-1 first (spec open question 3), drop the `use2` files/resources and the use2 PHZs; the structure is symmetric.
