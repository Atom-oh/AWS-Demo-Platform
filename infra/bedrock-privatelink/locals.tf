locals {
  existing_tgw_id    = "tgw-0162c7d68d7886619"
  existing_tgw_rt_id = "tgw-rtb-019c5cb46f743be38"

  consumer_vpc_ids = [
    "vpc-06801144309cad7dc", # mgmt-vpc   10.254.0.0/16
    "vpc-0e1b8458f46f9f81d", # prod-vpc   10.2.0.0/16
  ]
  consumer_cidrs = ["10.254.0.0/16", "10.2.0.0/16"]

  # Consumer subnet route tables that already route to the TGW (need endpoint-CIDR routes)
  consumer_route_table_ids = [
    "rtb-0f1ad80608917e523", "rtb-0fa4472d89b98c289", # mgmt-vpc
    "rtb-02abd8443cad569e5", "rtb-0213d02507cd872fc",
    "rtb-013d8a85e36d4e35f", "rtb-01584f9e581848e4d", # prod-vpc
  ]

  endpoint_vpc_cidr = { use1 = "10.60.0.0/24", use2 = "10.61.0.0/24" }
  endpoint_subnets = {
    use1 = { a = "10.60.0.0/26", b = "10.60.0.64/26" }
    use2 = { a = "10.61.0.0/26", b = "10.61.0.64/26" }
  }
  endpoint_azs = {
    use1 = ["us-east-1a", "us-east-1b"]
    use2 = ["us-east-2a", "us-east-2b"]
  }
}
