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
