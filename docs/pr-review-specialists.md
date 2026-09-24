# Specialist PR review

CI assigns distinct responsibilities instead of asking every model to repeat
every review lens. The trusted workflow enables this protocol with
`ROLE_REVIEW=1`; legacy matrix entrypoints remain for regression fixtures.

| Slot | Configured model | Responsibility |
| --- | --- | --- |
| `codex` | `global.openai.gpt-6-astra` | Implementation, concurrency, errors and tests |
| `kiro-fable` | `claude-fable-5.1` | AWS architecture, IAM, networking and service constraints |
| `kiro-sol` | `gpt-5.6-sol` | Deployment order, component contracts, lifecycle and recovery |
| `claude-self` | `global.anthropic.claude-opus-5-5` | Authentication, data boundaries, requirements, API and ADR consistency |

`kiro-fable` runs Kiro's `claude-fable-5.1` (the Kiro catalog has no Opus 5.5 on
the CI runner). Kiro catalog aliases (dotted) differ from Bedrock inference-profile
IDs, so the same model name is not interchangeable across CLIs. These are configured model identities, not attestation of
the provider's internal routing or weights.

## Routing and evidence

Trusted, deterministic path ownership (`OWNERSHIP` in `role_review.py`) assigns
every changed path to exactly one specialist — `infra/**`, `*.tf`/`*.tfvars`/
`*.hcl`, `accounts.yaml` and `atlantis.yaml` to `kiro-fable`; `k8s/**`, `argocd-apps/**`, `.github/workflows/**`,
`Dockerfile*`, `projects/**` and `docs/runbooks/**` to `kiro-sol`; API
plugins/routes, shared schemas, `docs/**` and `*.md` to `claude-self`; everything
else defaults to `codex`. No two roles review the same path, and a role with no
owned paths is NOT_APPLICABLE — this is the coverage reduction that keeps the
panel cheap and fast without leaving any changed path unreviewed. Diff *content*
(imports, ARNs, region strings) never affects routing; only the changed path
does. Only deterministic routing may record NOT_APPLICABLE; provider failures
never do.

`prepare_roles.py` verifies the pinned base checkout, resolves the immutable merge
base, fetches Git objects and generates a complete diff without executing head
code. It reads reviewer instructions from the base Git object. Candidate context
is checked for availability, size and generated-source freshness, then discarded.
The shared context ceiling is 24,000 bytes; AWS Demo Platform enforces 12,288 bytes.

Every result confirms its role, HEAD and reviewed paths. Host metadata binds it
to the prepared request and records the process status. Nonzero exits, malformed
or empty reports, missing paths, invalid fingerprints, model selection errors,
quota exhaustion and failed required roles block coverage. A JSON shape is
evidence of protocol completion, not proof that the model found every defect.

The common protocol accepts a complete diff within 3,000 lines and 95,000 UTF-8
bytes. It blocks oversized input without awarding credit for a prefix. AWS Demo
Platform has no chunk coordinator: split larger changes into reviewable PRs.
Other repositories' separately governed chunkers are not enabled by this protocol.

## Execution and synthesis

Each applicable model receives one specialist request. Both Kiro roles use fresh
HOME/cwd directories and an explicit empty tool catalog with no MCP resources or
hooks. Each active Kiro job first receives a fixed canary check without PR data;
only an exact successful no-tools response permits the actual review. Its child
environment excludes AWS and GitHub credentials. Errors remain visible; no
automatic quota or billing changes are made.

Codex retains its read-only sandbox and configured Bedrock provider. Claude's
specialist has no tools. The chair has bounded local read tools and no GitHub
token. Review output is scrubbed before becoming a public artifact.

The chair always finalizes an active review — a consolidated Summary/Blocking
issues/Non-blocking/Coverage write-up with one VERDICT line, not a separate
host-generated pass-through — except a coverage/input failure (deterministic
FAIL; the chair cannot waive it) or an all-NOT_APPLICABLE plan (deterministic
PASS, no owned path to review). To keep the extra call cheap, the chair receives
no diff at all for a clean run, only the affected paths' hunks for a Critical/
Major candidate, and the full owned diff only when a free-text uncertainty could
refer to any changed line.

Path ownership means most PRs activate one or two roles, not four: only the
owning specialist(s) run, each on its own owned-path slice of the diff, plus the
mandatory chair call. Retries and fallback add calls only when needed. Per-role
timing artifacts support before/after measurement.

## Maintenance and release

Run `python3 -m unittest discover -s scripts/pr-review -p 'test_*role*.py' -v`
and the repository's existing review tests. Offline fake CLIs validate routing,
scope, subprocess status and safety boundaries without spending model credits.
They do not establish successful live model execution.

Native `pull_request_target` uses base scripts, so a workflow-changing PR must
also have offline checks for the candidate implementation. Review the latest HEAD,
resolve real Critical/Major findings, satisfy required CI and branch rules, and
verify the integration path before merge. Missing review or quota failure is not
a clean result. Model limits and required gates remain in force.

## Approved source scope

`role-input-scope.json` preserves this repository's existing lockfile/generated-
asset exclusions. The trusted base copy classifies immutable Git paths before
requests are prepared. Provenance records every excluded path and both raw and
approved diff hashes. Renames are expanded into deletion/addition records so a
source path cannot disappear through an artifact rename. A verified exclusions-
only change is explicitly NOT_APPLICABLE and invokes no model; missing inputs,
unknown exclusions and truncated required source remain blocked. The policy does
not authorize excluding additional source merely to obtain a pass.

The distributed chair privately reconstructs issued frames with
`restore_role_frames.py` from its independently prepared inputs and downloaded
receipts. It validates the same digests without uploading raw request payloads;
altered existing frames or mismatched receipts block aggregation.
