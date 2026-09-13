# Project metadata

`projects/*.yaml` describes projects shown and operated by the dashboard. Use the
Zod schema in `dashboard/backend/packages/shared/src/schemas/project.ts` as the
contract for resource types, identifiers, optional briefing and URLs. Do not enable
an unsupported draft type or rely on an invented runtime-discovery placeholder.

Each project has a name, GitHub repo/branch, account and typed resources. The
account must match `accounts.yaml`; the worker indexes projects by `github.repo`.
ECS, EC2, RDS and ArgoCD apps have controllers. `dynamodb`, `elasticache`, `kafka`,
`msk`, `stepfunctions`, `lambda` and `firehose` require `always_on: true` and are
visibility-only. RDS may also opt out with `always_on: true`.

Use schema-supported IDs; URLs support `demo` and `code_server` only. Existing
`urls.spec`/`urls.architecture` fields are stripped by Zod and do not become
dashboard links. Credential values do not belong here. Invalid project files are
logged and skipped by the loaders, so a running API/worker does not prove every
entry was accepted.

The ArgoCD controller implements scale-to-one and restoration. Although the schema
accepts other `hpa_handling` values, the controller does not branch on them; do not
advertise `ignore` or `delete` as implemented lifecycle modes.

Set `management: external` when another system owns resource operations. The API
returns metadata with no platform lifecycle state and rejects on/off/scale;
the worker enforces the same boundary. The UI shows external management and
does not offer mutations. Omitted management and `platform` retain legacy
behavior. See [ADR-019](../docs/decisions/ADR-019-externally-managed-projects.md).

Hub-managed ArgoCD workloads need matching tenant Applications under
`argocd-apps/tenants/`; one project can have multiple tenant roots. Direct AWS and
visibility-only projects do not automatically need an ArgoCD root. An independent
ArgoCD installation needs supported connection configuration: the current worker
uses one configured ArgoCD client base URL, and changing a resource's cluster
metadata does not select another API endpoint. Workload namespaces are per-call.

API and worker images bundle project files; the worker also bundles `accounts.yaml`.
Project/account-only changes do not match current backend CI path filters, so
arrange the image build and explicit ECS rollout. A metadata merge alone does not
refresh deployed platform configuration.

Before retiring a project, inspect workload ownership and ArgoCD prune behavior.
Removing metadata and removing a tenant Application have different effects; neither
should be treated as a safe automatic deletion of all project resources. Update
onboarding/runbook details whenever the ownership pattern differs.

Current registrations are `multi-region-mall` (two spoke workload Applications
and always-on data resources), `call-center-admin` (visibility-only resources),
and `aws-fsi-demo` (externally managed metadata and demo link).
Old comments about their rollout phases are not deployment evidence.
