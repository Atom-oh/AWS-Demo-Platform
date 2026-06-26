# --- ap-ne2 side: existing default RT -> us-east endpoint CIDRs via peering ---
# Peering attachments auto-associate to the TGW default RT
# (default_route_table_association = "enable"); no explicit association needed.
resource "aws_ec2_transit_gateway_route" "apne2_to_use1" {
  provider                       = aws.apne2
  destination_cidr_block         = local.endpoint_vpc_cidr.use1
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use1.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id

  # The requester attachment is known at pendingAcceptance; wait for acceptance
  # so the route is created only once the peering is available.
  depends_on = [aws_ec2_transit_gateway_peering_attachment_accepter.use1]
}

resource "aws_ec2_transit_gateway_route" "apne2_to_use2" {
  provider                       = aws.apne2
  destination_cidr_block         = local.endpoint_vpc_cidr.use2
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment.use2.id
  transit_gateway_route_table_id = local.existing_tgw_rt_id

  depends_on = [aws_ec2_transit_gateway_peering_attachment_accepter.use2]
}

# --- us-east-1 side: routes back to consumers (accepter auto-associates) ---
resource "aws_ec2_transit_gateway_route" "use1_to_consumers" {
  provider                       = aws.use1
  for_each                       = toset(local.consumer_cidrs)
  destination_cidr_block         = each.value
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use1.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use1.association_default_route_table_id
}

# --- us-east-2 side (accepter auto-associates) ---
resource "aws_ec2_transit_gateway_route" "use2_to_consumers" {
  provider                       = aws.use2
  for_each                       = toset(local.consumer_cidrs)
  destination_cidr_block         = each.value
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_peering_attachment_accepter.use2.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway.use2.association_default_route_table_id
}
