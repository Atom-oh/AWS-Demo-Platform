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

# Requester: existing ap-ne2 TGW initiates peering to each us-east TGW
resource "aws_ec2_transit_gateway_peering_attachment" "use1" {
  provider                = aws.apne2
  transit_gateway_id      = local.existing_tgw_id
  peer_transit_gateway_id = aws_ec2_transit_gateway.use1.id
  peer_account_id         = data.aws_caller_identity.current.account_id
  peer_region             = data.aws_region.use1.region
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
  peer_region             = data.aws_region.use2.region
  tags                    = { Name = "demo-platform-bedrock-peer-apne2-use2" }
}

resource "aws_ec2_transit_gateway_peering_attachment_accepter" "use2" {
  provider                      = aws.use2
  transit_gateway_attachment_id = aws_ec2_transit_gateway_peering_attachment.use2.id
  tags                          = { Name = "demo-platform-bedrock-peer-apne2-use2" }
}
