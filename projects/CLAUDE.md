# Project metadata

`projects/*.yaml` describes projects shown and operated by the dashboard. Use the
Zod schema in `dashboard/backend/packages/shared/src/schemas/project.ts` as the
contract for resource types, identifiers, optional briefing and URLs. Do not enable
an unsupported draft type or rely on an invented runtime-discovery placeholder.

Each project has a name, GitHub repo/branch, account and typed resources. ECS, EC2,
RDS and ArgoCD apps have controllers; several other types are intentionally
visibility-only. Required resource IDs/names belong in schema-supported fields.
Credential values do not belong here; use scoped Secrets Manager references.

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
