# DynamoDB tables for the Lifecycle Controller (dev env).
# Spec: docs/superpowers/specs/2026-05-28-stage-2-lifecycle-controller-design.md §4.1.1
# PAY_PER_REQUEST, deletion protection on (prevent accidental state loss).

resource "aws_dynamodb_table" "state" {
  name         = "demo-platform-state-dev"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "jobs" {
  name         = "demo-platform-jobs-dev"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "history" {
  name         = "demo-platform-history-dev"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  deletion_protection_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}
