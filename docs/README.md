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
| [Review and release](runbooks/review-and-release.md) | Evidence required around review, deployment and removal |
| [Grafana operations](runbooks/grafana-private-ingress.md) | Private ingress and managed administrator lifecycle |
| [Dashboard deployment execution record](runbooks/dashboard-public-deploy-execution.md) | Historical June 2026 rollout; use current module/release guides for new deployments |
| [Decisions](decisions/) | Dated architectural rationale and accepted trade-offs |
| [Specs and plans](superpowers/) | Historical design/implementation records; not deployment status |
| [Changelog](../CHANGELOG.md) | Notable repository changes |

## Context synchronization

Edit root `CLAUDE.md` first when repository-wide context changes. Then invoke
`/co-agent:sync-context` to distill the same rules into root `AGENTS.md`. Only the
co-agent-marked generated file is replaced. The marker records the source SHA and
generation date; the installed co-agent `check_ai_context.py` checks freshness,
size and possible secrets. It does not check semantic completeness, so review the
summary against the source too.

Kiro's `.kiro/steering/project-context.md` points at `AGENTS.md`; it is not a separate
copy of the context. Keep generated guidance concise and point to module guides
rather than duplicating every implementation detail. Never include credential
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
