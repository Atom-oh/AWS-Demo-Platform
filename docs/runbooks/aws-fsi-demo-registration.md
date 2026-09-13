# AWS FSI demo registration

## Ownership

`projects/aws-fsi-demo.yaml` registers `Atom-oh/aws-fsi-demo` as externally managed.
It selects `atomoh-main`, not every account overlay in the FSI repository.
The 2026-09-13 inventory confirmed the `fsi-demo-cluster`, the three configured
DynamoDB tables, and public `fsi-demo.atomai.click` routing in that account.
Recheck those observations if the FSI deployment or its public routing moves.

The FSI repository owns its cluster, workloads, ArgoCD and demo-toggle procedure.
Do not create a hub tenant Application or change FSI replicas, autosync, GPU
activation or privacy gates as part of this registration. Registered table names
are metadata only; neither this process nor the platform reads their contents.
Use approved synthetic samples for any separate FSI demonstration.

## Validation and rollout

1. Parse all project YAML with the built shared schema. Verify the FSI definition
   retains `management: external`, the correct account and public URL.
2. Run backend build/lint/tests, frontend typecheck/lint/tests/build and the
   repository harness. Test both API rejection and worker rejection, including
   an external project with a normally controllable resource.
3. Complete current-HEAD AI review and CI. Backend and frontend code changes
   trigger their image workflows; a later metadata-only edit still needs an
   explicit backend image build under the current path filters.
4. Record current service/task definitions, desired counts and running image
   digests. Verify retained rollback images. Keep ARM64, auth settings, secret
   references, roles and desired counts.
5. Confirm the worker has no active job to interrupt. Roll the worker to the
   reviewed image first and verify readiness; then roll the API and frontend.
   Use explicit task-definition revisions with digest-pinned images.
6. Check API startup's project and external-project lists, running task digests,
   public root/health responses and anonymous API rejection. With an existing
   authenticated session, verify the FSI row/link and external-management label,
   no mutation controls, and no bulk on/off eligibility.

No FSI resource mutation is needed for verification. Local simulator tests are
not live deployment evidence; record actual runtime checks separately.

## Rollback

Restore verified retained image digests and the captured service settings.
The prior API bundle predates this registration, so rollback can remove the new
listing without touching FSI. Do not use mutable `main-latest` as a rollback pin.
Never copy the new metadata into an old worker/API image that does not enforce
external management. Repeat health/auth checks after rollback.

See [ADR-019](../decisions/ADR-019-externally-managed-projects.md) and the
[public dashboard rollout](dashboard-public-deploy-execution.md).
