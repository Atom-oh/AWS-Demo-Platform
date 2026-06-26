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
