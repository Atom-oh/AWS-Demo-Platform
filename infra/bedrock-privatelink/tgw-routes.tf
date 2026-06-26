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
