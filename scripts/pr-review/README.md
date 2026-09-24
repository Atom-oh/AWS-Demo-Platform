# AWS Demo Platform specialist review protocol

CI selects `ROLE_REVIEW=1`. Trusted inputs feed specialist executors; validated
results feed aggregation and, when needed, the chair. See
[the project contract](../../docs/pr-review-specialists.md).

| Tag | Requested model | Scope |
| --- | --- | --- |
| codex | `global.openai.gpt-6-astra` | Implementation/tests |
| kiro-fable | `global.anthropic.claude-opus-5-5` | AWS/IAM/network |
| kiro-sol | `gpt-5.6-sol` | Deployment/contracts/recovery |
| claude-self | `global.anthropic.claude-opus-5-5` | Auth/data/API/ADR |

`kiro-fable` means Opus. `kiro-fable`/`claude-self` share a model ID; the CLI
(`kiro-cli`/`claude`) disambiguates. `ROLES` governs specialists; legacy files
govern legacy execution. Kiro/Bedrock IDs differ. English is requested, not
validated; configured IDs do not attest model weights.

## API and input

`python3 scripts/pr-review/role_review.py COMMAND --help` lists flags.

| Command | Contract |
| --- | --- |
| prepare | Diff/context, HEAD/base, work; optional paths/provenance → `role-plan.json`, `roles/TAG.txt/.diff`. |
| issue | Work/tag → nonce, exact `requests/TAG.prompt/.input`, `slot/TAG-request.json`. Call before each attempt. |
| record | Tag, output/stderr, exit code, issued nonce → validated, scrubbed `slot/TAG-result.json`. |
| aggregate | Validate results/receipts → `role-summary.json`, `responded.txt`, `chair-mode.txt`, applicable report/flag. |

The executor sends issued bytes; hashes bind inputs, not transport. Keep tool data
out of diagnostics.

`--paths`: file containing a UTF-8 JSON array of unique repository-relative paths matching the patch,
e.g. `["src/api.ts"]`. Renames use destinations; the collector checks both sides.
Omit only for authoritative, unambiguous patch paths.

`--provenance`: file containing a JSON object. Required `head_sha`/`base_sha` equal the lowercase
40-character CLI revisions; `diff_sha256` hashes exact raw diff bytes. Example:

```json
{"head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","base_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","diff_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
```

Optional `input_failures` contains codes matching `[a-z][a-z0-9_:.-]{0,63}`; any code
blocks. Invalid provenance is discarded and blocks; stored values are scrubbed.
Optional `path_only: list[str]` identifies collector-approved metadata-only
deletions. Verify eligibility before withholding bodies.

## Coverage and lifecycle

`OWNERSHIP` assigns every changed path to exactly one role by path, not diff
content; `prepare` partitions the raw diff per role so each specialist receives
only its owned chunks. A role with no owned paths is NOT_APPLICABLE. Failed
output is never N/A. Parsing misses whole omissions/some cut prefixes: verify
Git scope/hashes.

BASE-approved exclusions-only scope may yield NOT_APPLICABLE/PASS without models.
Require empty diff/paths, `scope_exception: configured_exclusions_only`, lowercase
64-character `input_policy_sha256`, and identical nonempty unique safe
`scope_paths`/`excluded_paths`. The collector verifies policy/all paths; the report
shows exclusions/hash. Accidental empty input never qualifies. New exclusions
need policy review; project-specific exceptions remain.

Start fresh work before collection. `prepare` clears owned results/receipts, claims,
duplicate/terminal flags and histories; upstream flags remain. Issue/record exclude
each other; interrupted operations require fresh work. Duplicate records retain
the first result and block. Finish writers before aggregation. Reissue archives
32 prior results in `slot/TAG-attempts.json`; model-selection/fallback/quota/preflight
failures block until new preparation. Summaries retain history. All `*.flag` files
block except root `coverage-severe.flag`. `failure_codes` is canonical; `failures` aliases it.

Exit 2 means blocked. Aggregate exit 0: `not_applicable` permits the report
without a chair only when no role owns any path (e.g. an approved exclusions-only
scope); `review` always needs a chair, even with zero findings, so it can publish
one consolidated result. Blocked input yields deterministic FAIL; the chair
cannot waive coverage failures.

Publish scrubbed reports/receipts/metadata only; never raw `roles/*.diff` or
`requests/*.input/.prompt`.
After transport-only normalization, `record` reads a mode-0600 response file
outside the review workspace, removed even on errors. JSON/path values remain
intact until protocol validation and decoded redaction. Diagnostics are scrubbed.

## Limits and checks

Limits: 95,000 diff bytes (UTF-8), 3,000 lines, 24,000 context bytes, <128 KiB
request; projects may lower them. Oversize blocks. No chunk coordinator or
combining partial PASS results; preserve custody/budgets.
`CHAIR_PANEL_TOTAL_CAP` retains the legacy default and override (200,000 UTF-8
bytes by default), covering specialist-summary bytes only, not diff/context.
Oversized summaries produce FAIL before any chair call, without truncation.

Run `python3 -m unittest discover -s scripts/pr-review -p 'test_*role*.py'`.
Offline CI: `.github/workflows/pr-review-roles-tests.yml` covers the protocol,
executors, limits, artifact transport and workflow boundaries. Passing offline
checks does not prove live provider execution.

The Kiro GPT slot uses Sol. The wrapper accepts `REVIEW_CONTEXT_CAP` 1–12,288 (default 12,288).
Generic `prepare_roles.py` retains a 24,000-byte default; direct ADP protocol calls
must pass `--context-cap 12288` or less.
Record/aggregate also validate private issued-frame files. Distributed consumers
must restore them from trusted inputs/receipts before aggregation, never publish them.

Valid historical Critical/Major candidates and uncertainties remain subject to
adjudication after reissue; old attempts never provide current-role coverage.

Exclusions-only review requires both `--allow-exclusions-only --policy FILE`.
The trusted BASE collector supplies a schema-1 policy; its exact bytes must match
`input_policy_sha256`. The private `exclusions-policy.json` anchor is rechecked
during aggregation. Missing or mismatched opt-in blocks. The collector, not this
offline library, must establish complete Git scope and approved exclusions.

The model table targets CI's Bedrock Runtime provider. Local Mantle uses
`openai.gpt-6-astra` for Astra; provider-specific identifiers are not interchangeable.

React edits retain `kiro-sol`; altered or missing receipt-bound history blocks.

Chair Markdown redacts nested/multiline containers and handles quoted/escaped
delimiters. Parse-only validation rejects malformed, unclosed or unsupported syntax.
Uncertain boundaries consume the remaining reply, including its verdict.
Conditional, call, index, concatenation and continuation tails are rejected.
Plain paragraph text can preserve outside verdicts. Markdown bullets, headings,
links or closing fences can look like continuations and fail closed. Avoid sensitive
assignment examples in summaries. Amazon Bedrock/Kiro hard account limits stop
retries and chair fallback, including stdout and mixed diagnostics. Transient
throttling alone may use the configured fallback.

## Executor inputs and limits

CI calls `prepare-inputs.sh`, `run-panel.sh`, `aggregate.sh` and `synthesize.sh`.
The all-roles wrapper below is the local/offline entrypoint.

- `run-specialists.sh DIFF UNUSED WORK`: uses the context cap above, `HEAD_SHA`,
  `BASE_SHA`, and `GH_REPO` or `GITHUB_REPOSITORY`. The second argument preserves
  the legacy calling shape; roles replace lens files. Default ADP preparation
  rebuilds the diff from immutable Git objects.
- `prepare_roles.py`: the default ADP path requires `AGENTS.md` at BASE and HEAD,
  checks size and generated-source hashes, and retains only BASE instructions.
  `role-input-scope.json` supplies BASE exclusions.
- `prepare_context_roles.py`: optional BASE-verified hook; may not raise the cap.
- `role-project.json`: optional schema-1 policy with `context_sources`, bounded
  `chair` settings and a BASE-matching `prepare_project_roles.py` adapter.
  ADP has neither hook nor project policy.
- `run_role.py`: defaults/maxima are 300/900 seconds (`PANEL_TIMEOUT`), 2/3 total
  attempts (`PANEL_RETRIES`) and 60/120 seconds (`KIRO_PREFLIGHT_TIMEOUT`).
- `synthesize_roles.py`: reads legacy `CHAIR_*` defaults; positive environment
  values apply even without a legacy default. Project policies declare maxima;
  the absolute timeout ceiling is 1,500 seconds. ADP defaults to a 600-second
  timeout and has no explicit turn/fast-fail default. The chair uses
  Read/Grep/Glob and denies Bash.
- `role-controls.sh`: uses the canonical `lib.sh` control stripper. Private JSON
  reaches protocol validation before credential redaction.
