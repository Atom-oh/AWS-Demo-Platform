data "aws_caller_identity" "current" {
  provider = aws.apne2
}

# Region handles (for peering attachment cross-region wiring)
data "aws_region" "use1" { provider = aws.use1 }
data "aws_region" "use2" { provider = aws.use2 }
