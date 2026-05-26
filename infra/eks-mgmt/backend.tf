terraform {
  backend "s3" {
    bucket         = "multi-region-mall-terraform-state"
    key            = "production/ap-northeast-2/eks-mgmt/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "multi-region-mall-terraform-locks"
    encrypt        = true
  }
}
