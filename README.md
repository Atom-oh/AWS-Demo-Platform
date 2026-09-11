# AWS Demo Platform

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.1-green.svg)]()

Admin platform for GitHub-linked AWS demo projects across multiple accounts.

## Overview

The EKS hub runs Atlantis, ArgoCD, ESO, observability and CI runners. The dashboard
API, asynchronous worker and Next.js frontend run separately on ECS Fargate.
Repository code includes project discovery, lifecycle control, briefing/history,
bulk turn-on and per-resource demo scaling. Terraform defines the dev runtime.

Implementation, image publication and live deployment are different states. CI
builds/pushes images; ECS service rollout is explicit. Verify current revisions,
TLS and health before a demo rather than using this README as a live inventory.

Start with [CLAUDE.md](CLAUDE.md), the [documentation map](docs/README.md) and
[current architecture](docs/architecture.md). [AGENTS.md](AGENTS.md) is the generated
reviewer summary, not a separate source of policy.

## Features

- Hub-spoke GitOps with system and tenant App-of-Apps roots.
- PR-driven Terraform through Atlantis and scoped cross-account roles/ExternalIds.
- CloudFront-only public ingress using a private VPC Origin and internal ALB.
- Dashboard discovery, resource detail, URLs, briefing, history, bulk on and scale.
- Asynchronous lifecycle jobs with restoration data and restart recovery.
- Grafana private ingress and an ESO-synchronized administrator credential.

Kubernetes Pod IP registration uses TargetGroupBinding; the binding is not a traffic
hop. The internal observability NLB exception is limited to private fan-in.
Grafana's CloudFront distribution/DNS remain owned by `multi-region-architecture`;
this repository owns its private backend and Kubernetes resources.

## Prerequisites and setup

- AWS CLI v2 with an authorized identity for the intended account and operations.
- Terraform 1.9.6, matching Atlantis; DynamoDB backend locking, not `use_lockfile`.
- kubectl with the intended hub/spoke contexts; ArgoCD access for GitOps operations.
- Node 20 and pnpm 9 for dashboard development.
- Docker/LocalStack for backend integration tests; Python PyYAML for Grafana harness checks.

```bash
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform
bash scripts/setup.sh
```

Use [developer onboarding](docs/onboarding.md) for local development and
[friend-account onboarding](docs/onboarding/friend-account-setup.md) for cross-account
setup. Existing instance credentials may already be available; verify identity and
network access before replacing them.

## Project structure

| Path | Purpose |
| --- | --- |
| `accounts.yaml`, `projects/` | Schema-validated account/project metadata |
| `dashboard/backend/` | Node/TypeScript shared clients, Fastify API and SQS worker |
| `dashboard/frontend/` | Next.js admin UI |
| `infra/` | Stateful Terraform root modules and reusable submodules |
| `k8s/system/` | Hub components, Grafana resources and explicitly targeted spoke overlays |
| `argocd-apps/` | Bootstrap roots, system Applications/ApplicationSets, tenant roots |
| `docs/` | Current guides, ADRs, runbooks and dated design history |
| `scripts/`, `tests/` | Setup, review orchestration and local verification |

A project requiring hub-managed ArgoCD workloads needs corresponding tenant coverage;
metadata-only or direct AWS projects do not automatically need a tenant Application.
Backend project/account configuration is baked into images. Project-only edits do
not trigger the current backend image workflow, so plan the build and rollout too.

## Verification and release

| Area | Commands |
| --- | --- |
| Backend, from `dashboard/backend` | `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` |
| Frontend, from `dashboard/frontend` | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` |
| Harness | `bash tests/run-all.sh` |
| Terraform module | `terraform init -backend=false`, `terraform fmt -check`, `terraform validate`; review the real plan |
| Kubernetes | `kubectl kustomize <dir>` and appropriate dry-run with the explicit context |

Backend integration tests require LocalStack on port 4566. Check skipped tests and
prerequisite failures rather than reporting them as a pass.

Normal Terraform changes use Atlantis plan/apply comments. Kubernetes manifests
follow ArgoCD. Apply resource producers before merging consumers, and verify actual
public behavior after cutover. AI review is supplemental; it is not proof of runtime
health or enforced branch protection. Use the [review/release runbook](docs/runbooks/review-and-release.md)
and [Grafana runbook](docs/runbooks/grafana-private-ingress.md).

This is non-production; brief outages and small deployments are intentional.
`main` is the dev target and semver tags express the production release convention;
the current image workflows do not implement automatic tag-to-prod rollout.

## Contributing and context synchronization

Create a focused branch, run the relevant checks and open a PR. Review actual
Atlantis plans and current-head findings before applying/merging. Fork PRs may not
run the same secrets-backed review path, so do not assume a skipped workflow is approval.

Update root/module `CLAUDE.md`, architecture and runbooks when contracts change.
Then run `/co-agent:sync-context` to regenerate marked `AGENTS.md`; preserve its
source-hash marker and Kiro bridge. See the [documentation map](docs/README.md).

## License

MIT — see [LICENSE](LICENSE) when added.
