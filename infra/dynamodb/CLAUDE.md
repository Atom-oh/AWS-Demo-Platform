# infra/dynamodb

Lifecycle Controller state store (Stage 2, dev). Three PAY_PER_REQUEST tables:
`demo-platform-state-dev`, `-jobs-dev` (GSI1 `gsi1pk`/`gsi1sk`, TTL), `-history-dev` (TTL).

- **State key**: `production/aws-demo-platform/dynamodb/terraform.tfstate`
- **Outputs**: `{state,jobs,history}_table_{name,arn}`
- **Guards**: `deletion_protection_enabled = true` + `prevent_destroy` — tearing down needs both removed first.
- Runs as `AtlantisIRSARole` (has `dynamodb:*`). Atlantis project `dynamodb`.
