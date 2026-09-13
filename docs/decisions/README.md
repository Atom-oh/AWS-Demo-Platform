# Decision applicability

ADRs record dated decisions. An amendment supersedes only its stated topic; it
need not invalidate the entire ADR. Current code/configuration and scoped guides
establish implementation, while runtime observations require dated live evidence.
Historical names, cost estimates and catalog probes are not current guarantees.

| ADR | Applies to | Supersession / current reference |
| --- | --- | --- |
| [001](ADR-001-sqs-worker-for-async-jobs.md) | Async lifecycle jobs and recovery | [Dashboard guide](../../dashboard/CLAUDE.md); separate persistence/queue writes |
| [002](ADR-002-argocd-control-via-rest-api.md) | ArgoCD REST control | Per-call namespaces; one configured endpoint |
| [003](ADR-003-gha-oidc-ecr-push.md) | Repository image-push OIDC | Image workflows and `infra/iam` |
| [004](ADR-004-same-origin-cloudfront-dashboard.md) | Same-origin dashboard routing | `infra/cloudfront`; Grafana has separate ownership/policies |
| [005](ADR-005-cognito-spa-auth-code-pkce.md) | Browser authentication | Access token and API admin allowlist |
| [006](ADR-006-arm64-graviton-native-build.md) | ARM64 runtime/build alignment | Current Dockerfiles and ECS task definitions |
| [007](ADR-007-mgmt-observability-internal-nlb-exception.md) | Private observability NLB exception | Does not permit public Grafana ingress |
| [008](ADR-008-cross-region-bedrock-privatelink.md) | Historical private Bedrock network | Fully superseded by ADR-009; removed module |
| [009](ADR-009-revert-bedrock-privatelink-to-public-path.md) | Revert that dedicated network | Public egress decision; not a model/region pin |
| [010](ADR-010-bedrock-account-data-retention-for-fable-mythos.md) | Recorded account retention posture | Verify current account/endpoint before diagnosis or change |
| [011](ADR-011-pr-review-kiro-roster-gpt55-drop-v3.md) | Kiro CLI route without `--v3` | Models amended by 013/014/015 |
| [012](ADR-012-ai-trader-web-oidc-plan-apply-split.md) | External ai-trader-web plan/apply trust split | This repo owns IAM; external workflow/protections need verification |
| [013](ADR-013-pr-review-gpt56-model-bump.md) | Independent Codex/Kiro access paths | Original model IDs superseded; see PR review map |
| [014](ADR-014-pr-review-opus5-model-bump.md) | Anthropic selections and catalog recovery | Dated updates; Kiro aliases differ from Bedrock IDs |
| [015](ADR-015-pr-review-per-model-parallel-jobs.md) | Per-model jobs, roster structure, artifacts and coverage floor | Supersedes 016's topology/roster, not its ownership decision |
| [016](ADR-016-multi-ai-pr-review-panel.md) | Panel/chair architecture, shared context and runner-image ownership | Partially amended; retains context-delivery and compatibility updates |
| [017](ADR-017-demo-scale-job-operation.md) | Async scale and HPA restoration | Accepted partial-failure limits; inspect before next off cycle |
| [018](ADR-018-grafana-private-origin.md) | Grafana private path and credential rollout | Split repo/state ownership and producer-first readiness |
| [019](ADR-019-externally-managed-projects.md) | Registration without resource control | External management enforced by API, worker and UI |

[PR review](../pr-review.md) maps configured slots, trusted inputs and actual
coverage behavior. [Review and release](../runbooks/review-and-release.md) defines
operator checks. [Historical specs/plans](../superpowers/) are not additional merge
gates; the August review hardening spec remains a proposal where not implemented.

Preserve original decision dates and scope when summarizing an ADR. Add a dated
amendment for a changed decision, or the next unused ADR for a new architecture
choice. Documentation repairs and an exception within an existing ownership
contract do not automatically need a new ADR number. Original detail remains in
Git history; keep links to current contracts in the retained record.
