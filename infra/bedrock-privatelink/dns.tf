# Resolve the private IPs of each interface endpoint's ENIs so we can publish
# them as A records in cross-region-reachable Route 53 private hosted zones.

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
    use1_runtime = {
      zone = "bedrock-runtime.us-east-1.amazonaws.com"
      ips  = [for eni in data.aws_network_interface.use1_runtime : eni.private_ip]
    }
    use1_mantle = {
      zone = "bedrock-mantle.us-east-1.api.aws"
      ips  = [for eni in data.aws_network_interface.use1_mantle : eni.private_ip]
    }
    use2_runtime = {
      zone = "bedrock-runtime.us-east-2.amazonaws.com"
      ips  = [for eni in data.aws_network_interface.use2_runtime : eni.private_ip]
    }
    use2_mantle = {
      zone = "bedrock-mantle.us-east-2.api.aws"
      ips  = [for eni in data.aws_network_interface.use2_mantle : eni.private_ip]
    }
  }
}

# One PHZ per Bedrock service-region, created in ap-northeast-2 and associated
# to the first consumer VPC inline. The second VPC is associated separately
# (below) with ignore_changes on vpc to avoid Terraform fighting the inline
# association — the documented pattern for multi-VPC private hosted zones.
resource "aws_route53_zone" "this" {
  provider = aws.apne2
  for_each = local.phz
  name     = each.value.zone
  comment  = "Cross-region Bedrock PrivateLink DNS (${each.key})"

  vpc {
    vpc_id     = local.consumer_vpc_ids[0]
    vpc_region = "ap-northeast-2"
  }

  lifecycle {
    ignore_changes = [vpc]
  }
}

resource "aws_route53_zone_association" "second" {
  provider   = aws.apne2
  for_each   = local.phz
  zone_id    = aws_route53_zone.this[each.key].zone_id
  vpc_id     = local.consumer_vpc_ids[1]
  vpc_region = "ap-northeast-2"
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
