# Documentation map

Read current contracts before historical plans. Repository state describes what is
implemented or declared; it does not prove the current deployment is healthy or
running the latest image.

| Document | Purpose |
| --- | --- |
| [Root CLAUDE.md](../CLAUDE.md) | Canonical contributor/operator guide and repository invariants |
| [Root AGENTS.md](../AGENTS.md) | Generated reviewer summary of CLAUDE.md, with source hash |
| Module `CLAUDE.md` files | Scoped implementation, state ownership and commands |
| [Architecture](architecture.md) | Current component boundaries, routing and ownership |
| [Developer onboarding](onboarding.md) | Local setup and development workflow |
| [PR review contract](pr-review.md) | Current input delivery, model-slot mapping, coverage limits and false-positive checks |
| [Review and release](runbooks/review-and-release.md) | Evidence required around review, deployment and removal |
| [ai-trader review runner](runbooks/ai-trader-review-runner.md) | Dedicated CLI compatibility pin, retained image evidence and recovery |
| [PR-review panel](runbooks/pr-review-panel.md) | Kiro preflight, quota exhaustion and ignored-agent failure modes |
| [oh-my-cloud-skills Kiro bridge](runbooks/ohmy-kiro-runtime-compat.md) | Immutable launcher producer, separate consumer activation, revision retention and recovery |
| [Grafana operations](runbooks/grafana-private-ingress.md) | Private ingress and managed administrator lifecycle |
| [Dashboard rollout](runbooks/dashboard-public-deploy-execution.md) | Current rollout and verification procedure, with a dated initial-deployment record |
| [FSI registration](runbooks/aws-fsi-demo-registration.md) | External management, metadata scope and guarded rollout |
| [ARM64 migration and rollback](runbooks/arm64-graviton-migration.md) | Architecture-change and rollback procedure; historical observations are dated |
| [Decision applicability](decisions/README.md) | Topic-level ADR ownership, supersession and accepted trade-offs |
| [Specs and plans](superpowers/) | Historical design/implementation records; not deployment status |
| [Changelog](../CHANGELOG.md) | Notable repository changes |

## Context synchronization

Edit root `CLAUDE.md` first when repository-wide context changes. Then invoke
`/co-agent:sync-context` to distill the same rules into root `AGENTS.md`. Only the
co-agent-marked generated file is replaced. The marker records the source SHA and
generation date; the installed co-agent `check_ai_context.py` checks freshness,
size and possible secrets. The validator does not check semantic completeness,
so review the summary against the source too. CI validates both base and candidate
digests against a 12-KiB delivery cap, stricter than the generator's 32-KiB cap;
only base content is supplied to reviewers. The harness checks the tracked digest.
The marker is the first 12 hexadecimal characters of SHA-256 over the UTF-8
`CLAUDE.md` text, so freshness can also be checked without an installed plugin.

Local Kiro steering points at `AGENTS.md`; CI Kiro runs in an isolated directory
without read tools. `prepare-inputs.sh` explicitly fetches the digest at the event's
base SHA and supplies it to applicable specialists and conditional adjudication. PR-head instructions remain
untrusted diff data. The local bridge alone cannot supply CI context.

Keep generated guidance concise and point to module guides rather than duplicating
every implementation detail. Never include credential
values or temporary machine/session state in shared agent context.

The generator's marker uses the mode form `/co-agent sync-context`; the standalone
command `/co-agent:sync-context` invokes the same operation. Preserve the emitted
marker rather than editing its provenance by hand.

## Ownership and evidence

- AWS Demo Platform owns its hub cluster, dashboard runtime, internal ALB, shared
  VPC Origin and Grafana Kubernetes resources.
- `Atom-oh/multi-region-architecture` owns the Grafana CloudFront distribution and
  public DNS in `terraform/environments/production/ap-northeast-2/shared`.
- Image build/push, ECS rollout, Kubernetes synchronization and public availability
  require different checks. See the release runbook before changing live routing.
- Keep dates on incident observations. Model catalogs, quotas, certificates,
  branch protections, Pod IPs and service counts can change; verify them live.

## Reading and editing rules

Read root/scoped current guides first, then the relevant accepted decision and its
amendments. A historical plan explains intent, not current APIs or deployment
status. A partially superseded ADR keeps authority for unaffected topics. Verify
contradictions with concrete source paths and distinguish implementation from intent.

All tracked Markdown, agent instructions and code comments use English; localized
product UI and its test assertions may be Korean. Keep historical records concise,
retaining dates, rationale, limitations and links. Obsolete code transcripts remain
in Git history rather than repeated in every review context. Templates are aids,
not mandatory sections in every document.

- [Specialist PR review](pr-review-specialists.md): current role routing, coverage and synthesis.
