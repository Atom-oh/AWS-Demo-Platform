locals {
  consumer_route_pairs = {
    for pair in setproduct(local.consumer_route_table_ids, values(local.endpoint_vpc_cidr)) :
    "${pair[0]}_${pair[1]}" => { rt = pair[0], cidr = pair[1] }
  }
}

resource "aws_route" "consumer_to_endpoints" {
  provider               = aws.apne2
  for_each               = local.consumer_route_pairs
  route_table_id         = each.value.rt
  destination_cidr_block = each.value.cidr
  transit_gateway_id     = local.existing_tgw_id
}
