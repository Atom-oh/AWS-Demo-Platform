# Developer onboarding

## Prerequisites

- Authorized AWS CLI v2 identity for the intended account, cluster and needed secret paths.
- Terraform 1.9.6, matching `atlantis.yaml`; use DynamoDB-table locking.
- Node 20/pnpm 9 for the dashboard; Docker for LocalStack integration tests.
- kubectl with hub/spoke contexts, ArgoCD access, and Python PyYAML for Grafana checks.
- Access to this repository and any resource-owner repository involved in the change.

## Setup and identity

```bash
git clone git@github.com:Atom-oh/AWS-Demo-Platform.git
cd AWS-Demo-Platform
bash scripts/setup.sh
aws sts get-caller-identity
kubectl --context mall-apne2-mgmt config view --minify
```

Verify the selected context resolves to `mall-apne2-mgmt` and the expected account;
`kubectl config current-context` reports only the default, which may be another
cluster. Pass `--context` on cluster operations. A sandbox can block instance
metadata and make existing instance credentials appear absent; verify the permitted
network path before replacing credentials.

Use an existing authorized ArgoCD session or interactive login. Do not put passwords
in command arguments or print tokens from Secrets Manager into logs. Verify TLS
before authenticating. The [Grafana runbook](runbooks/grafana-private-ingress.md)
separately describes its administrator secret and private access path.

## Read current context first

1. [CLAUDE.md](../CLAUDE.md) and the relevant module guide.
2. [Documentation map](README.md) and [architecture](architecture.md).
3. [Review/release procedure](runbooks/review-and-release.md).
4. Relevant [ADRs](decisions/) and [friend-account setup](onboarding/friend-account-setup.md).
5. Dated specs/plans only for historical rationale; they are not current deployment status.

`AGENTS.md` is distilled from root `CLAUDE.md`; regenerate it after source changes
with `/co-agent:sync-context` and validate its marker, source hash, size and secrets.

## Local development and checks

From `dashboard/backend`, install dependencies, start LocalStack with `pnpm stack:up`
when running integration tests, then run `pnpm -r build`, `pnpm -r lint` and
`pnpm -r test`. Compilation is the real TypeScript gate. For the simulated local
worker path, run `PORT=8087 node packages/api/dist/dev-server.js` after building.

From `dashboard/frontend`, install dependencies and run
`NEXT_PUBLIC_AUTH_ENABLED=false API_ORIGIN=http://localhost:8087 PORT=3001 pnpm dev`.
The explicit flag is required for tokenless local use; unset means auth enabled.
Alternatively copy `.env.local.example` to `.env.local`. This bypass is for the
simulated local API, not the deployed JWT-protected API. Validate with `pnpm typecheck`,
`pnpm lint`, `pnpm test` and `pnpm build`. The local API has simulated resource state;
it is not a health probe for deployed AWS resources.

Run `bash tests/run-all.sh` for the local harness. Terraform verification is per
module: initialization, format, validation and a real plan against the correct
backend. Render Kubernetes with `kubectl kustomize`; client/server dry-runs may
need credentials and already-created dependencies even though they do not deploy.

## Development and deployment workflow

Use focused `feat/`, `fix/`, `docs/`, `refactor/` or `chore/` branches and conventional
commit messages. Keep the source, documentation and generated context aligned.

- Terraform: review the PR plan, then apply through Atlantis. Apply a target group
  before merging its binding; a remote-state consumer may need a new plan afterward.
- Kubernetes: merge reviewed manifests and verify ArgoCD sync plus actual behavior.
  Separately synchronized Secret producers must be Ready before consumers change.
- Dashboard: CI builds/pushes images but service revisions/counts are out-of-band.
  Pin and deploy the intended task definition; verify the running image and endpoint.
- Project/account metadata: images bundle these files. Current backend CI filters
  do not trigger on project/account-only changes, so arrange a build and rollout.
  ArgoCD tenant coverage is needed only when this hub actually owns those workloads.

## Preparing a demo

- Add optional `briefing` text to schema-valid project YAML; the detail drawer
  expands longer notes with Show more.
- Cards and the drawer expose GitHub links and configured URLs.
- Bulk turn-on processes off/error projects with bounded concurrency.
- Demo scale supports ECS desired counts and ArgoCD workload/HPA replicas without
  changing the project's on/off status. HPA min/max are pinned by scale; the first
  observed bounds are preserved so a later off/on cycle can restore them. See
  [ADR-017](decisions/ADR-017-demo-scale-job-operation.md) for accepted races and
  partial-failure limitations.

## Troubleshooting without losing context

| Symptom | Check before changing anything |
| --- | --- |
| Backend initialization conflict | Verify account, bucket and exact state key before reconfiguration; do not invent a new key |
| `use_lockfile` rejected | This repository pins Terraform 1.9.6 and uses `dynamodb_table` |
| ArgoCD OutOfSync | Inspect the actual error, ownership and producer readiness; resolve declaratively |
| Stale ArgoCD revision | Refresh/sync through ArgoCD and verify the resulting revision |
| Namespace termination | Investigate remaining resources/controllers before considering finalizer removal |
| Atlantis unavailable | Check Pod health, HTTPS certificate, webhook delivery and `--write-git-creds` |
| Public 502 with healthy Pods | Trace CloudFront's actual origin and owning repository/state, target health and TLS |
| Hub Pod pending | Check node selection and required taint tolerations |

Do not use resource deletion, namespace-finalizer clearing, disabled TLS verification
or broad SG ingress as generic troubleshooting shortcuts.
