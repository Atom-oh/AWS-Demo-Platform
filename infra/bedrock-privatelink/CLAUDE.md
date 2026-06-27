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
