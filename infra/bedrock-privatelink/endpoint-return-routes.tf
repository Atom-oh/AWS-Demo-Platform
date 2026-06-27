# Return path: the endpoint-VPC subnet route tables must send consumer-bound
# traffic back through the regional TGW. Without these, the interface-endpoint
# ENIs receive requests (forward path via propagated 10.60/61.x route on the TGW)
# but have no route to reply to the ap-ne2 consumer CIDRs → asymmetric routing →
# connection timeout. (The TGW *route tables* carry the consumer routes; the
# endpoint VPC's own subnet RT did not until now.)

resource "aws_route" "use1_endpoint_to_consumers" {
  provider               = aws.use1
  for_each               = toset(local.consumer_cidrs)
  route_table_id         = aws_route_table.use1.id
  destination_cidr_block = each.value
  transit_gateway_id     = aws_ec2_transit_gateway.use1.id
  depends_on             = [aws_ec2_transit_gateway_vpc_attachment.use1]
}

resource "aws_route" "use2_endpoint_to_consumers" {
  provider               = aws.use2
  for_each               = toset(local.consumer_cidrs)
  route_table_id         = aws_route_table.use2.id
  destination_cidr_block = each.value
  transit_gateway_id     = aws_ec2_transit_gateway.use2.id
  depends_on             = [aws_ec2_transit_gateway_vpc_attachment.use2]
}
