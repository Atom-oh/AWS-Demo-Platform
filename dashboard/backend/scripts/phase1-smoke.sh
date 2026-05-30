#!/usr/bin/env bash
set -euo pipefail
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=ap-northeast-2

# Tables
aws --endpoint-url=$AWS_ENDPOINT_URL dynamodb create-table \
  --table-name demo-platform-state-dev \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true
aws --endpoint-url=$AWS_ENDPOINT_URL dynamodb create-table \
  --table-name demo-platform-jobs-dev \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH \
  --global-secondary-indexes 'IndexName=gsi1,KeySchema=[{AttributeName=gsi1pk,KeyType=HASH},{AttributeName=gsi1sk,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true
aws --endpoint-url=$AWS_ENDPOINT_URL dynamodb create-table \
  --table-name demo-platform-history-dev \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST 2>/dev/null || true

# Queue
aws --endpoint-url=$AWS_ENDPOINT_URL sqs create-queue --queue-name demo-platform-jobs-dev 2>/dev/null || true

echo "phase 1 smoke setup complete"
