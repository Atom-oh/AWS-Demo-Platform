# ADR-019: Register externally managed projects without taking control

## Status

Accepted — 2026-09-13.

## Context

`aws-fsi-demo` has its own EKS cluster, ArgoCD applications and operating procedures.
The platform worker uses one ArgoCD endpoint; changing a resource's cluster field
does not connect it to FSI's independent ArgoCD. Registration must not transfer
GitOps ownership, enable dormant workloads or imply that platform toggles control
the complete FSI deployment.

## Options considered

1. Register it as a normal project using only visibility-only resources. This
   fits the existing schema but still permits meaningless lifecycle bookkeeping.
2. Add a multi-endpoint ArgoCD or FSI-specific controller. This needs a separate
   control/credential design and workload scope; registration alone does not
   establish that integration.
3. Add explicit external management metadata with enforced read-only behavior.
   This makes the project discoverable while keeping its existing owner.

## Decision

Use option 3. `management: external` is an optional project-schema field.
Omitted values and `platform` preserve existing behavior.

- External projects expose configured metadata and URLs with `state: null`.
  Existing bookkeeping is retained but not reported as external workload health.
  Startup does not initialize their platform lifecycle state.
- The API rejects on/off/scale before state changes or queueing. The worker also
  rejects externally managed jobs before account/credential lookup, controller calls
  or project-state writes,
  including messages queued before a configuration change.
- The frontend derives an `external` display status from management metadata,
  excludes it from on/off eligibility, and hides mutation controls. This display
  status is not a new DynamoDB lifecycle state.
- FSI uses the existing `atomoh-main` account entry, its verified public demo URL
  and supported DynamoDB metadata. EKS/AgentCore ownership is described in its
  briefing; unsupported resource types or dummy ArgoCD targets are not added.

## Consequences

The dashboard can list independently operated projects without acquiring their
credentials or changing their infrastructure. This registration does not inspect
table contents, discover live workload health or provide FSI on/off/scale control.
Full lifecycle integration remains a separate change.

Changing management mode is an ownership handover, not automatic state migration.
Quiesce submissions and settle queued/running jobs before transferring an existing
project. A late rejected job leaves prior lifecycle/restoration data untouched,
including a possible `transitioning` state. Before re-adoption, reconcile that
bookkeeping with the actual resources and retained HPA baselines; simply removing
`management: external` does not recover or validate old state. This FSI registration
creates a new external entry and performs no such handover.

Ship worker enforcement before API exposure, followed by the frontend display.
Images bundle code and metadata; use verified immutable digests. During rollback,
restore a compatible code/config bundle, never feed external metadata to older
binaries that silently discard the field. See the
[registration runbook](../runbooks/aws-fsi-demo-registration.md).

## References

- [Project metadata contract](../../projects/CLAUDE.md)
- [ArgoCD endpoint boundary](ADR-002-argocd-control-via-rest-api.md)
- [Dashboard contracts](../../dashboard/CLAUDE.md)
