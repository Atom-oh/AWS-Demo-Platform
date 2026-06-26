output "endpoint_vpc_ids" {
  value = { use1 = aws_vpc.use1.id, use2 = aws_vpc.use2.id }
}

output "bedrock_runtime_ips" {
  description = "Private IPs the PHZ resolves bedrock-runtime to (per region)"
  value = {
    use1 = local.phz.use1_runtime.ips
    use2 = local.phz.use2_runtime.ips
  }
}

output "bedrock_mantle_ips" {
  value = {
    use1 = local.phz.use1_mantle.ips
    use2 = local.phz.use2_mantle.ips
  }
}

output "tgw_peering_attachment_ids" {
  value = {
    use1 = aws_ec2_transit_gateway_peering_attachment.use1.id
    use2 = aws_ec2_transit_gateway_peering_attachment.use2.id
  }
}
