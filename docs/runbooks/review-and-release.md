# Review and release evidence

## Purpose

Use code review to identify defects, then verify deployment prerequisites and
runtime behavior separately. This applies to normal changes and incident recovery.
The process here is operator guidance; it does not claim that GitHub branch rules
or every described check are already enforced by automation.

## Before review

1. Confirm the base branch, current head and intended scope. Separate applied or
   squash-merged work from truly unmerged changes; preserve unrelated drafts.
2. Identify every owner of affected resources, including other repositories and
   Terraform states. For ingress, trace DNS → CloudFront → origin → targets and
   locate each configuration before deleting or replacing anything.
3. Run relevant deterministic checks from [CLAUDE.md](../../CLAUDE.md). Do not treat
   vitest as a TypeScript check, a missing-prerequisite skip as a pass, or a script
   with placeholder IDs as proof about live resources.
4. Prepare a reviewable diff and plan. Keep credential values out of source,
   Terraform state, process arguments and logs.

## Interpret the current AI workflow

`.github/workflows/pr-review.yml` runs four configured panel slots over L2–L5 and
publishes the chair's synthesized verdict. Actual model IDs and invocation settings
live in `scripts/pr-review/`, the workflow and runner configuration.

Check three separate outcomes: did the model execute successfully, did it actually
review the required input/lenses, and did its findings survive verification?
A successful job or non-empty output does not prove useful review coverage. Read
warnings and match the verdict to the current head SHA. Inspect human review
requests and required status checks as well.

Model/catalog/quota errors are review-infrastructure failures, not defects that an
application patch necessarily fixes. Keep them visible. Do not enable paid
quota overages or modify a workflow simply to turn a repair green. Investigate
findings against source and live evidence; neither severity labels nor a model
majority establish facts on their own.

The 2026-09-11 assessment observed absent main protections, green jobs with missing
Kiro responses, and a coverage-only failure in the Grafana owner's repository.
These are dated observations, not permanent settings. Verify current protection
and ruleset settings through GitHub before relying on enforcement.

The [gate-hardening proposal](../superpowers/specs/2026-08-09-pr-review-gate-hardening-design.md)
records remaining work such as exit/coverage validation, complete diff handling,
stale-head/fork behavior and publisher credential separation. A merged proposal
is not an implemented safeguard. Keep AI review supplemental until the intended
gate is implemented, tested and enforced alongside deterministic checks.

## Apply and cut over

1. Inspect a real Terraform plan with the intended identity, account, region and
   state key. Apply prerequisites through Atlantis before merging resources that
   reference them. A remote-state consumer may need a new plan after its dependency
   applies.
2. For separately synchronized producers and consumers, make readiness an explicit
   gate. Grafana's ExternalSecret must exist and contain the verified managed
   credential before the Helm consumer change is merged.
3. Build/push does not deploy ECS services: select and pin the intended task-definition
   revision, perform the rollout and verify running tasks/counts. Keep ARM64 images
   and task architecture aligned.
4. Deploy the replacement path and check target health, authentication and data
   access. Keep the old path until the replacement is ready when possible.
5. Cut over the external origin/DNS only after those checks. Confirm TLS, both
   expected public hosts, login, anonymous rejection and an authenticated request.
6. Remove obsolete infrastructure only after mapping its consumers and verifying
   the new path. ArgoCD Healthy describes its managed objects, not every external
   consumer or dependency. Observe repeat checks after the cutover.

## Incident exceptions

If a deployment tool is itself unavailable, first diagnose its endpoint, TLS and
identity. Existing instance credentials may be inaccessible only inside a sandbox;
verify the permitted access path before replacing credentials.

An exceptional release requires operator authorization, a bounded reviewed change,
independent assessment and concrete validation. Record the current commit, resource
plan, failure/exception reason, checks performed and source reconciliation. Preserve
failed CI status rather than falsifying success or weakening its policy. A targeted
Terraform recovery plan proves only its selected scope, not the whole environment.

Keep the applied fix in the owning source repository so a later ordinary apply
cannot silently undo it. Recovery is complete when the intended service works and
its source/configuration agrees, not merely when an API mutation returns success.

## Lessons from the Grafana recovery

PR #98 removed the public NLB before the external CloudFront consumer in
`multi-region-architecture` was verified, leaving the public hosts returning 502.
A passing review and healthy Kubernetes workload did not prove availability.
Restoration reused the private ALB/VPC Origin, repaired an expired Atlantis viewer
certificate, and verified the actual Grafana administrator credential.

The review of #100 did identify a real cross-Application ordering problem. Splitting
the Secret producer and Helm consumer, verifying ESO Ready and explicitly rotating
the persisted database credential resolved it. This is useful supplemental review,
combined with runtime evidence rather than substituted for it. See
[ADR-018](../decisions/ADR-018-grafana-private-origin.md) and the
[Grafana runbook](grafana-private-ingress.md).
