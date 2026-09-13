# PR review gate hardening — proposal

**Date:** 2026-08-09. **Status: PROPOSAL.** Recovered from local commit `5e87bb3`
and reconciled on 2026-09-11; source applicability rechecked 2026-09-13.
This describes a target gate, not an implemented or enforced merge requirement.
Original detailed test plans and review history remain in Git history.

## Problem and existing evidence

[ADR-015](../../decisions/ADR-015-pr-review-per-model-parallel-jobs.md) introduced four
independent panel jobs and one chair. Runs on PRs #89/#90 were recorded as evidence
of artifact aggregation and publication, not reliable validation of every model
response or complete review coverage.

Source-supported safeguards already exist: trusted-base workflow checkout,
SHA-pinned comparison inputs, Kiro child-process isolation/tool restrictions,
ANSI normalization and full-output secret scrubbing before truncation, and
aggregation that marks zero-response lenses or severe model dropout as failures.
PR #85 implemented the sanitation ordering and removed unused GitHub MCP
allowlist/PAT wiring; those are existing changes, not proof this proposal landed.

The current [workflow](../../../.github/workflows/pr-review.yml) still places all
panel/chair jobs on one runner label. The chair both synthesizes and publishes
with a write-enabled token. [Panel retry](../../../scripts/pr-review/run-panel.sh)
can accept nonempty output from a failed command. [Aggregation](../../../scripts/pr-review/aggregate.sh)
does not require two responses per lens. [Input preparation](../../../scripts/pr-review/prepare-inputs.sh)
limits the diff to 3,000 lines without the proposed global byte cap/forced-failure
contract. No separate publisher or stable `AI Review Gate` job exists.

The 2026-09-11 rules query returned no active ruleset rules for `main`; it did
not inspect legacy branch protection and is not a current enforcement audit.
Model IDs have evolved; [review documentation](../../pr-review.md) and
[`lib.sh`](../../../scripts/pr-review/lib.sh) own the roster.

## Proposed contract

| Boundary | Required behavior if this proposal is implemented |
| --- | --- |
| Credentials | No process consuming PR-controlled text receives GitHub write credentials; Kiro keys exist only on Kiro pods/children |
| Cells | CLI exits zero and emits meaningful visible output after normalization; discard failed partial output, retry, and use a kill-after grace period |
| Coverage | At least two distinct model-tag responses for every lens; fewer force failure, without claiming provider diversity from tag count |
| Completeness | Global 3,000-line or 500,000-byte truncation forces failure; Kiro-only truncation is tolerated only with successful full-diff reviewers |
| Publication | Check the event HEAD against current PR HEAD immediately before writing; paginate and edit only the bot's marker comment |
| Enforcement | One stable required check named `AI Review Gate`; failures, unsupported fork events and missing results cannot pass |
| Sanitation | Normalize and scrub complete output before retaining stderr tails; sanitation failure prevents raw artifact upload |
| Dependencies | Pin Actions by commit SHA and remove runtime Claude installation fallback; preserve Terraform 1.9.6 |

## Proposed architecture and rationale

Split ARC labels into `aws-demo-platform-claude-arm` (Codex, Claude self-review,
chair; no Kiro key) and `aws-demo-platform-kiro-arm` (Kiro slots). Child environment
filtering alone does not isolate a pod-wide secret from ancestor-process access.

The job sequence would be read-only panel → read-only chair/rendered artifact →
write-only publisher → stable gate. The publisher would neither check out code
nor run a model. The chair would publish its failure explanation before the final
gate fails, preserving diagnostics. Add reopened/ready-for-review handling and
explicit fork failure rather than relying on conditionally skipped jobs.

Extract sanitation into a tested helper, including unquoted `KIRO_API_KEY`
assignments and prefix-spanning secrets. Retain full-file scrubbing before a
4,000-byte stderr tail. Clear run-scoped flags before repeated execution.
Reject nonzero/timed-out chair output even if it contains a plausible verdict.
None of these proposed controls should be described as installed solely because
related helper functions or tests exist.

## Implementation and verification still required

Preserve the original dependency order: regression tests and shell helpers,
runner isolation, job separation, a same-repository test PR and fork fixture,
then explicit branch-rule activation/readback after the stable check exists.
Tests must exercise failed-command stdout, whitespace/ANSI-only output,
per-lens coverage, global/Kiro truncation, sanitation boundaries, stale reruns,
bot-comment pagination and orchestration failure. Rendering, shell/YAML checks
and the harness complement those behavioral tests; they do not replace a live
workflow/enforcement check.

Use the [release runbook](../../runbooks/review-and-release.md) and
[current review guide](../../pr-review.md) for present operation. Do not weaken
existing checks or budgets to make this proposal appear complete.
