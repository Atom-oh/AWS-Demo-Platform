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
