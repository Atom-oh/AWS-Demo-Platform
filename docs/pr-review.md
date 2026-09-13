# PR review contract

This is the current workflow map. The implementation is
[pr-review.yml](../.github/workflows/pr-review.yml) and
[scripts/pr-review](../scripts/pr-review/). [ADR-016](decisions/ADR-016-multi-ai-pr-review-panel.md)
owns panel/chair design and runner-image ownership; later ADRs amend specific topics.

## Inputs and trust

`pull_request_target` runs trusted base code for same-repository PRs targeting
`main`. Each panel/chair job prepares the same three-dot diff using event base/head
SHAs. `prepare-inputs.sh` also retrieves `AGENTS.md` at that exact **base SHA**,
embeds it in each lens and saves it for the chair prompt. Empty, unavailable or
>12 KiB base context fails preparation. Candidate `AGENTS.md` bytes are separately
size-checked and discarded, preventing an oversized edit from breaking subsequent
runs; candidate content never becomes reviewer instructions.
Head documentation remains untrusted diff data; edits to review
scripts first affect native CI after merge. Do not run head scripts with trusted
runner credentials to test a workflow change.

Local `.kiro/steering/project-context.md` points to `AGENTS.md`. CI Kiro uses an
isolated cwd/HOME and no read tools, so that bridge alone cannot deliver context.
Each fresh cell receives the trusted
[`kiro-inline-review.json`](../scripts/pr-review/kiro-inline-review.json) as
`.kiro/agents/inline-review.json`; the command explicitly selects `--agent inline-review`.
The profile sets `tools: []` and `allowedTools: []`, with no MCP servers, resources
or hooks and `useLegacyMcpJson: false`. `run-panel.sh` rejects a profile whose
content deviates (including duplicate JSON keys) before any model call. Directory
preparation, profile validation and copying must succeed before the affected Kiro
call; failures stop execution rather than reusing stale state or falling back to
default tools.

The [Kiro configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/)
distinguishes available `tools` from approval-free `allowedTools`. PR #109 run
`34729311650` (head `2d47015`, `kiro-fable/L2`) produced only glob-search output
under `--trust-tools=` alone: kiro-cli 2.11.1 parses the empty value as a custom
tool name, warns and ignores it, so the default catalog survived. The named profile
is the only guard; `--trust-tools=` and the v3-only `--mode default` were removed
from the invocation so nobody mistakes them for one. The `--v3` engine ignores
`tools: []` and is not used.

Each Kiro job first runs a preflight: a fixed canary prompt with the same profile
in an empty directory must return exactly `NO_TOOLS`; otherwise the PR diff is
withheld from that job's cells and the chair forces failure. After the review,
stderr signatures for an ignored `--agent` (response discarded, forced failure)
and for monthly quota exhaustion (`Monthly request limit reached`, not retried,
cause named in the comment) are folded into per-model flags inside the uploaded
slot. Offline profile validation and mocked preflight/signature tests check
configuration and control flow, not successful model execution or meaningful
review coverage. Failure handling is in the
[panel runbook](runbooks/pr-review-panel.md).

Kiro gets context plus capped diff in argv; other cells get the prepared context
and diff through their existing prompt/stdin paths. An assembled Kiro argument of
131,072 bytes or more fails explicitly instead of being truncated. Context
retrieval does not grant tools or GitHub credentials. Codex uses a read-only
sandbox; Claude self-review/chair have bounded read tools. Read-only tools are
not proof of zero data-exfiltration risk; preserve credential minimization.

The shared base digest provides contracts, not complete unchanged source. Verify
a suspected missing guard against code before treating it as a defect. The local
checkout is base code; distinguish it from the reviewed head. Claims about deployed
resources need separate live evidence.

## Configured slots

| Slot | Model source | Current configured value |
| --- | --- | --- |
| `codex` | `docker/actions-runner-claude/config.toml` | `global.openai.gpt-6-astra`, `amazon-bedrock-runtime` |
| `kiro-fable` | `KIRO_MODELS` in `scripts/pr-review/lib.sh` | `claude-opus-5` |
| `kiro-sol` | `KIRO_MODELS` in `scripts/pr-review/lib.sh` | `gpt-5.6-sol` |
| `claude-self` | workflow `ANTHROPIC_MODEL` | `global.anthropic.claude-fable-5-1` |
| Chair primary / fallback | `synthesize.sh` defaults; environment overrides supported | `global.anthropic.claude-fable-5-1` / `global.anthropic.claude-opus-5` |

Four panel slots × L2 infra / L3 security / L4 correctness / L5 docs = 16 cells,
then one chair. Slot names are artifact/dispatch identifiers: `kiro-fable` is a
legacy tag and currently runs Opus. `kiro-opus` is historical. Two Kiro slots share
one service; model-family overlap and shared context can correlate findings.
Four slots do not mean four independent vendors. A configured ID is not proof
of current catalog support, response success or the binary/model baked into a live
runner. Verify each actual access path after a catalog or image change.

Claude's configured Bedrock endpoint and `AWS_REGION` both use `ap-northeast-2`.
A global profile does not remove their signing-region agreement requirement.
The runner image and its baked Codex config change on rebuild; repository shell
scripts change on subsequent trusted-base runs. The dedicated ai-trader-web runner
has a separate [CLI compatibility pin](runbooks/ai-trader-review-runner.md).

## Findings and documentation

Report a changed path, reproducible failure condition, impact and source evidence.
Confidence measures evidence; severity measures impact. Missing unchanged hunks,
unknown live state and incomplete coverage are uncertainties, not demonstrated
code defects. Check them explicitly. A verified regression remains reportable even
when a related limitation already exists.

Use current root/module guides and [ADR applicability](decisions/README.md).
An ADR may be accepted for architecture while its roster or topology is superseded.
Historical snippets and design proposals are not present-day configuration or new
merge requirements. A dated operational exception belongs with its owning decision
and runbook unless it changes architecture. Documentation/comments/review output
are English; dashboard UI copy and localized test expectations may be Korean.

Do not infer production HA requirements for this demo platform, blanket-apply HPA
rules to unmanaged workloads, rename adopted resources, or require bilingual
sections. Optional hardening belongs in suggestions with its trade-off and scope.

## Coverage and merge evidence

The current implementation counts non-empty output, not validated semantic success.
Preparation filters selected generated/lockfile hunks and truncates at 3,000 lines;
Kiro further caps diff text at 100,000 bytes. Warnings/flags expose truncation.
Aggregation forces failure when at least three of four model rows are empty or a
lens has no responses. One or two empty model rows are warnings, not forced failure.
A non-empty error response can still be counted. These are actual limitations, not
assurance that the review is complete.

The chair validates its final verdict shape, tries a fallback on invalid generation,
and forces failure on severe coverage loss. Only the chair job publishes the
comment, although its model process still runs in that job's credential context.
`!cancelled()` reduces stale-run races; it is not a final current-head publication
check. Fork reviews and stronger result/head validation remain in the
[gate-hardening proposal](superpowers/specs/2026-08-09-pr-review-gate-hardening-design.md).

Before merge independently check latest-HEAD AI output and inline comments,
Critical/Major resolution, meaningful required coverage, deterministic checks,
branch rules and intended base/dependencies. Fix, retest and rereview every new
HEAD. A green job, generic PASS, stale review or missing response is insufficient.
Follow [review and release](runbooks/review-and-release.md); do not weaken limits or
gates to obtain a pass.

## Verification

`bash tests/run-all.sh` includes mocked review pipeline tests. They verify input
provenance, Kiro context delivery, explicit empty-tool profile selection and
validation, the preflight gate, quota and agent-fallback signature handling,
failure before default-agent fallback, argument limits, artifact aggregation,
scrubbing and chair failure behavior. They do not prove the installed CLI's model behavior or
judgment quality. Reverify profile compatibility and actual review output after
CLI upgrades; a nonempty tool log is still not a completed review.
For a script-changing PR, assess supplemental review at the exact head with trusted
inputs and read-only model access, alongside native CI's base-version results.
