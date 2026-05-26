terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0" }
  }
  backend "s3" {
    bucket         = "multi-region-mall-terraform-state"
    key            = "production/aws-demo-platform/cloudfront/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "multi-region-mall-terraform-locks"
  }
}

provider "aws" {
  region = "ap-northeast-2"
  default_tags {
    tags = { Project = "aws-demo-platform", Component = "cloudfront", ManagedBy = "terraform" }
  }
}
