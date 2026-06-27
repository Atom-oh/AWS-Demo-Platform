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
