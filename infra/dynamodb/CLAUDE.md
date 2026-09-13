# infra/dynamodb

Lifecycle state store for dev. Three PAY_PER_REQUEST tables:
`demo-platform-state-dev`, `demo-platform-jobs-dev` (index `gsi1` on
`gsi1pk`/`gsi1sk`, TTL) and `demo-platform-history-dev` (TTL).

- **State key**: `production/aws-demo-platform/dynamodb/terraform.tfstate`
- **Outputs**: `{state,jobs,history}_table_{name,arn}`
- **Guards**: `deletion_protection_enabled = true` plus `prevent_destroy`, so tearing a table
  down requires removing both guards first — that friction is intentional.
- Runs as `AtlantisIRSARole` (has `dynamodb:*`). Atlantis project `dynamodb`.
