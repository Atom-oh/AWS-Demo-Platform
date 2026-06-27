locals {
  default_tags = {
    Project     = "aws-demo-platform"
    Component   = "bedrock-privatelink"
    ManagedBy   = "terraform"
    Environment = "dev"
  }
}

provider "aws" {
  alias  = "apne2"
  region = "ap-northeast-2"
  default_tags { tags = local.default_tags }
}

provider "aws" {
  alias  = "use1"
  region = "us-east-1"
  default_tags { tags = local.default_tags }
}

provider "aws" {
  alias  = "use2"
  region = "us-east-2"
  default_tags { tags = local.default_tags }
}
