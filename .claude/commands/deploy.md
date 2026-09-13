---
description: Deploy authorized changes through the owning Terraform, GitOps or ECS path
allowed-tools: Read, Bash(git status:*), Bash(git push:*), Bash(argocd app sync:*), Bash(argocd app list:*), Glob
---

# Deploy

Follow `docs/runbooks/review-and-release.md` and the affected module guide/runbook.
Confirm target commit, account, region, cluster and resource/state ownership.
Preserve unrelated working changes; do not stash, switch branches or delete live
resources as generic error recovery. Run relevant checks and inspect actual plans.

- Terraform: open/review the feature PR, request `atlantis plan -d infra/<module>`,
  inspect the plan, then apply within the authorized scope. Dependencies must exist
  before planning remote-state consumers or merging dependent manifests.
- Kubernetes: merge reviewed changes through the normal PR path. ArgoCD follows
  each owning Application's revision and destination. Validate render/dry-run,
  synchronization and affected runtime behavior with explicit kube context.
- ECS: image publication does not roll services. Select the intended task-definition
  revision and verify running revision/count, health, authentication and data access.
- Project/account metadata: bundled into images; metadata-only edits miss backend
  CI filters. Arrange an explicit build/rollout. They are not ArgoCD workload manifests.

For shared ingress or credential changes, deploy and verify producer/replacement
readiness before consumer/cutover, then verify public TLS/login/data. A generic
health endpoint or ArgoCD Healthy is not sufficient evidence for the whole path.

Investigate sync failures using the owning Application, prerequisites and schema.
For SharedResourceWarning, resolve both owners before changing tracking annotations
or pruning. Do not delete an alleged orphan without a consumer inventory.

Rollback follows the owning runbook and reviewed plan. A Git revert does not
restore database credentials or Terraform state. Prefer a forward fix; never use
`terraform destroy` as generic rollback. Report deployed commit, scope and evidence.
