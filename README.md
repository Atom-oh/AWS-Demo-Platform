# AWS Demo Platform

Admin platform for GitHub-linked AWS demo projects across multiple accounts.
The EKS hub hosts GitOps, Terraform automation, observability and CI runners;
the Fastify API, SQS worker and Next.js dashboard have separate ECS Fargate
runtime definitions. This is a non-production platform.

## Implemented capabilities

- Browse configured projects in the default table or optional cards, with search,
  facets and attention/name/account ordering. Inspect resources, URLs, briefing and
  history; confirm bulk on/off for selected eligible rows.
- Track queued and active batch attempts, retain results and retry failed items.
  Up to four client attempts run at once under per-project lifecycle/scale locks.
  This state survives dashboard refresh while mounted, but not a browser reload.
- Run asynchronous lifecycle jobs and ECS/ArgoCD demo scaling. Restoration and
  restart replay have [documented limits](docs/decisions/ADR-001-sqs-worker-for-async-jobs.md);
  [HPA recovery](docs/decisions/ADR-017-demo-scale-job-operation.md) requires saved bounds.
- Use Cognito access-token authorization, scoped cross-account roles/ExternalIds,
  Atlantis-managed Terraform and hub/spoke ArgoCD Applications.
- Register independently operated projects, including `aws-fsi-demo`, with
  read-only metadata and demo links under [external management](docs/decisions/ADR-019-externally-managed-projects.md).
- Route public traffic through CloudFront, a private VPC Origin and internal ALB.
  [Architecture](docs/architecture.md) defines ownership, including Grafana's
  cross-repository CloudFront/DNS boundary.

The dashboard reads project YAML loaded at API startup and stored lifecycle
state, not live resource health. Worker GitHub discovery is a separate snapshot;
it does not automatically add projects to the UI. See the
[dashboard guide](dashboard/CLAUDE.md) and [frontend guide](dashboard/frontend/CLAUDE.md).

Code, image publication and live deployment are different states. CI pushes
images but ECS rollout is explicit. Project/account metadata is bundled into
images, and metadata-only edits do not trigger backend CI. Verify the running
revision and actual demo behavior after rollout.

## Setup and checks

Use Node 20 and pnpm 9 for dashboard development; Docker/LocalStack supplies
backend integration dependencies. Infrastructure work needs an authorized AWS
identity, Terraform 1.9.6 and explicitly selected Kubernetes contexts.

```bash
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform
bash scripts/setup.sh
```

Follow [developer onboarding](docs/onboarding.md) for local servers and
[friend-account onboarding](docs/onboarding/friend-account-setup.md) for account access.

| Scope | Local verification |
| --- | --- |
| `dashboard/backend` | `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` |
| `dashboard/frontend` | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` |
| Repository harness | `bash tests/run-all.sh` |
| Terraform module | Init, format, validate and review the actual plan before apply |
| Kubernetes | Render Kustomize and dry-run with the intended context and prerequisites |

Backend integration tests need LocalStack on port 4566; Grafana harness checks
need kubectl/PyYAML. Inspect skips. Frontend CI runs typecheck/lint/build but does
not run Vitest. CI success does not establish live health or branch protection.

## Repository and review context

| Path | Responsibility |
| --- | --- |
| `accounts.yaml`, `projects/` | Account roles and project metadata |
| `dashboard/` | Shared clients/schemas, API, worker and frontend |
| `infra/` | Terraform roots and reusable modules |
| `k8s/system/`, `argocd-apps/` | Hub and targeted spoke components, GitOps roots/Applications |
| `scripts/`, `tests/` | Setup, review automation and local checks |
| `docs/` | Architecture, decisions, runbooks and dated design history |

[CLAUDE.md](CLAUDE.md) is canonical; [AGENTS.md](AGENTS.md) is its generated reviewer
summary. Use the [documentation map](docs/README.md) to find the owning guide and
the [review/release runbook](docs/runbooks/review-and-release.md) for integration,
deployment order and verification. Update affected guides when contracts change;
regenerate root context through `/co-agent:sync-context`.

Repository docs/comments are English; the dashboard UI uses Korean copy.
See [CHANGELOG.md](CHANGELOG.md) for release history. This checkout does not contain
a license file.
