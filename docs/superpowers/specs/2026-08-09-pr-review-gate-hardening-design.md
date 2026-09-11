# PR Review Gate Hardening Design

- **Date**: 2026-08-09
- **Status**: Recovered proposal; partially implemented, remaining work pending
- **Reconciled**: 2026-09-11 against `main` at `e4feb6f`
- **Scope**: `.github/workflows/pr-review.yml`, `scripts/pr-review/`,
  `tests/pr-review/`, the AWS Demo Platform ARC runner manifests, reviewer
  context documentation, and the GitHub `main` branch ruleset

## Current Implementation And Remaining Work

This proposal was recovered from local commit `5e87bb3`. It describes a target
architecture, not the deployed workflow. The sections below use future tense
or imperative requirements for work that remains pending.

PR #85 already implemented ANSI normalization and full-output secret scrubbing
before artifact and stderr truncation. That ordering must be preserved when
extracting a sanitation helper. It also removed the unused GitHub MCP tool
allowlist entries and `GITHUB_PERSONAL_ACCESS_TOKEN`.

The current workflow still shares one runner label across all four panel jobs
and the chair. The chair still synthesizes with a write-enabled GitHub token
and publishes its own comment. There is no separate publisher or stable
`AI Review Gate` job. `aggregate.sh` rejects zero-response lenses, but does not
require two responses per lens; `prepare-inputs.sh` has a 3000-line cap without
a byte cap or forced failure for global truncation. Cell/chair exit-status
validation, stale-head publication checks, and action SHA pinning remain pending.

On 2026-09-11, `gh api repos/Atom-oh/AWS-Demo-Platform/rules/branches/main`
returned an empty list: no active ruleset rules applied to `main` in that
response. This query does not inspect legacy branch protection. Rule activation
remains a separate implementation and verification step, not a consequence of
merging this document.

Model IDs have moved since the original proposal: Codex uses
`global.openai.gpt-6-astra`; Kiro uses `claude-fable-5.1` and `gpt-5.6-sol`;
the primary chair uses `global.anthropic.claude-fable-5-1`. Preserve the current
roster in `scripts/pr-review/lib.sh` and runner configuration when implementing
this design. The four slot tags below identify jobs, not frozen model versions.
Terraform remains pinned to `1.9.6` in Atlantis; this proposal does not change
that policy.

## 1. Purpose

ADR-015 successfully split the review panel into four per-model jobs and a
chair job. Live runs on PRs #89 and #90 proved the normal topology:

- four panel jobs start independently;
- each panel job uploads one slot artifact;
- the chair downloads all four artifacts;
- one synthesized review comment is posted.

The implementation is not yet a reliable fail-closed merge gate. Model failures can be counted
as valid responses, sparse responses can bypass the cross-checking floor, and
secret-bearing model processes share credentials with the write-enabled
publisher. This design closes those gaps without changing the four-model
roster or the lens definitions. Branch enforcement must be inspected and
configured explicitly as described in section 8.

## 2. Security And Gate Invariants

The hardened workflow must enforce these invariants:

1. No process that consumes PR-controlled text has a GitHub write token.
2. The Kiro API key exists only on Kiro runner pods and Kiro child processes.
3. Secret scrubbing runs on complete output before any byte truncation.
4. A model cell is valid only when the CLI exits successfully and produces
   meaningful non-ANSI, non-whitespace output.
5. Every lens has at least two valid model responses before a PASS is possible.
6. A globally truncated PR diff can never produce a PASS.
7. A stale workflow rerun cannot overwrite the current head's review comment.
8. One stable required check, `AI Review Gate`, is the sole merge-gate contract.
9. Unsupported fork PRs fail that gate explicitly instead of succeeding through
   conditionally skipped jobs.

## 3. Chosen Architecture

### 3.1 Runner Separation

Use two ARC runner scale sets built from the same ARM64 image:

| Runner label | Models/jobs | Kiro key |
|---|---|---|
| `aws-demo-platform-claude-arm` | Codex, Claude self-review, chair | absent |
| `aws-demo-platform-kiro-arm` | `kiro-fable`, `kiro-sol` | injected from `ai-panel-keys` |

The existing Claude runner manifest stops injecting `KIRO_API_KEY`. A new Kiro
runner manifest carries the existing ExternalSecret reference. The panel matrix
uses `matrix.include` to select both model tag and runner label.

Removing the key only from a child process is insufficient because a model with
filesystem tools can inspect ancestor process environments under `/proc`.
Pod-level separation is therefore the narrowest complete credential boundary.

### 3.2 Workflow Jobs

The workflow becomes:

```text
panel (matrix, read-only)
  -> chair (read-only synthesis and comment rendering)
  -> publish (write-only GitHub comment upsert)
  -> AI Review Gate (stable required check)
```

#### Panel

- Keeps `pull-requests: read` and `contents: read`.
- Checks out only the trusted base revision.
- Uses the SHA-pinned compare diff.
- Uploads scrubbed model slot artifacts.
- Runs Kiro models only on the Kiro runner label.
- Runs Codex and Claude self-review only on the clean Claude runner label.

#### Chair

- Has `pull-requests: read` and `contents: read`, never write.
- Downloads and aggregates panel artifacts.
- Runs the Claude chair and computes `gate_result`/`gate_reason`.
- Renders the complete comment into an artifact.
- Does not fail solely because the verdict is FAIL; this allows the publisher
  to post the blocking reason before the final gate job fails.

#### Publisher

- Has `pull-requests: write`; it does not check out the repository or run an LLM.
- Downloads only the rendered comment artifact.
- Fetches the PR's current head SHA immediately before publishing.
- Does not update the marker comment unless the current head equals the event
  head SHA.
- Searches all issue-comment pages and only edits the GitHub Actions bot's
  marker comment.

#### AI Review Gate

- Runs after panel, chair, and publisher with `if: !cancelled() && always()`.
- Fails when the PR is from a fork, any orchestration job failed, publication
  failed, or the chair's `gate_result` is not `pass`.
- Is the only status check configured in the `main` branch ruleset.
- Keeps matrix job names and internal workflow topology out of the external
  branch-protection contract.

The workflow also handles `reopened` and `ready_for_review` events so the
required check is not missing on those PR transitions.

## 4. Panel Result Validation

### 4.1 Cell Success

`try_panel` records a successful cell only when:

- the wrapped command exits zero; and
- the output contains at least one visible character after ANSI escape
  sequences and whitespace are removed.

Nonzero commands have their partial stdout cleared and are retried. After the
last failed attempt, the slot remains empty so aggregation marks it missing.
All `timeout` calls use a short `--kill-after` grace period so TERM-ignoring
children cannot consume the full job timeout.

The chair applies the same rule: a nonzero or timed-out Claude process cannot
leave a partial response that passes `chair_valid`.

### 4.2 Coverage Floor

Aggregation preserves the existing zero-row model warning and adds a minimum
per-lens floor:

- two or more valid model responses for a lens: eligible for synthesis;
- fewer than two: `coverage-severe.flag`, forced FAIL.

The floor counts distinct model tags. Provider diversity is not a new gate
condition in this patch because the accepted roster intentionally includes two
different models transported through Kiro.

## 5. Diff Completeness

`prepare-inputs.sh` applies both:

- `MAX_DIFF_LINES`, default `3000`;
- `MAX_DIFF_BYTES`, default `500000`.

If either cap truncates the diff, `diff-truncated.flag` is created and the final
review is forced to `VERDICT: FAIL`. The review comment explains that the PR
must be split or manually reduced; a warning-only partial PASS is prohibited.

Kiro keeps its lower argv byte cap. Kiro-only truncation may remain warning-only
when Codex or Claude self-review successfully covers the complete globally
bounded diff. If both full-diff models are degraded, Kiro truncation also forces
FAIL.

Run-scoped flags such as `diff-truncated.flag` and `chair-failed.flag` are
cleared at script startup to make repeated execution in one workdir deterministic.

## 6. Secret Handling

Add an explicit `KIRO_API_KEY` redaction rule, including unquoted shell-style
assignments. Preserve the existing generic token, JWT, GitHub, AWS, and PEM
rules.

Extract the existing artifact sanitation from the workflow into a testable
repository script, preserving PR #85's normalization and scrubbing order:

```text
sanitize-artifacts.sh <slot-dir>
```

For `.md` files it normalizes ANSI/control sequences, scrubs the complete file,
and atomically replaces it. For `.err` files it applies the same normalization
and scrubbing first, then retains the final 4000 bytes. Any scrub or replacement
failure fails the panel job; raw output is never uploaded as a fallback.

Chair stderr excerpts follow the same scrub-before-truncate order.

## 7. Dependency And Policy Consistency

- Pin GitHub Actions to full commit SHAs, retaining version comments.
- Remove the runtime `npm install -g @anthropic-ai/claude-code` fallback.
  A missing baked CLI is an image failure and must fail closed.
- Preserve the Terraform `1.9.6` pin in `atlantis.yaml` and the matching
  reviewer guidance. Do not introduce a `1.9.8` repository target through
  this review-pipeline change.
- Keep `CLAUDE.md`, model prompts, tests, and architecture/ADR text consistent
  with the implemented topology as each stage lands.
- Update published review text from `Kiro x3` to `Kiro x2`.

## 8. GitHub Ruleset

After the workflow is merged and `AI Review Gate` has appeared on a test PR,
create an active branch ruleset targeting `main` with that check as required.
Do not require the four matrix checks or the chair/publisher implementation
jobs directly.

The ruleset is verified through:

```bash
gh api repos/Atom-oh/AWS-Demo-Platform/rules/branches/main
```

The result must include a required status check named exactly
`AI Review Gate`.

## 9. Test Strategy

Follow red-green TDD for each behavior:

1. `test-run-panel.sh`
   - nonzero command with stdout is retried and not counted;
   - ANSI/whitespace-only output is not counted;
   - successful meaningful output remains valid.
2. `test-aggregate.sh`
   - diagonal 4/16 responses force severe coverage failure;
   - exactly two responses per lens remain eligible.
3. `test-prepare-inputs.sh`
   - SHA compare ordering;
   - line and byte truncation flags;
   - large run followed by small run clears stale state.
4. `test-sanitize-artifacts.sh`
   - unquoted `KIRO_API_KEY` redaction;
   - PEM and generic secrets crossing the tail boundary do not survive;
   - legitimate diagnostics remain.
5. `test-synthesize.sh`
   - stale chair flags are cleared;
   - nonzero chair output is rejected;
   - global truncation and uncovered Kiro tails force FAIL.
6. `test-publish-comment.sh`
   - stale head does not publish;
   - pagination finds the existing bot marker;
   - current head posts or updates normally.
7. `test-workflow.sh`
   - read/write job separation;
   - dedicated runner mapping;
   - stable final gate and fork failure;
   - pinned action SHAs and no runtime package install.

Verification includes focused tests, `bash -n`, YAML parsing, the complete
`tests/run-all.sh` suite, manifest rendering, and one live same-repository test
PR. A fork-event fixture verifies the final gate fails without exposing secrets.

## 10. Migration Order

1. Add failing regression tests.
2. Harden shell helpers, aggregation, synthesis, and artifact sanitation.
3. Add the Kiro runner scale set and remove the key from the Claude runner.
4. Split chair, publisher, and final gate jobs.
5. Align project policy documentation.
6. Run local and manifest verification.
7. Open a test PR and verify all jobs plus the final check.
8. Apply and verify the GitHub `main` ruleset.

The existing four-model roster, English-only model output, SHA-pinned diff
fetch, artifact-per-model topology, and one-comment user experience remain
unchanged.
