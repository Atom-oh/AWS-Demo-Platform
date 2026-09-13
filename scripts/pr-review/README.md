# Specialist review protocol

The protocol and provider executors are staged. The legacy workflow remains active.
Activation and workflow/E2E verification follow separately. `prepare_roles.py`
validates inputs, `run_role.py` executes one specialist, `synthesize_roles.py`
adjudicates valid findings, and `restore_role_frames.py` restores private frames.

| Tag | Requested model | Scope |
| --- | --- | --- |
| codex | `global.openai.gpt-6-astra` | Implementation/tests |
| kiro-fable | `claude-opus-5` | AWS/IAM/network |
| kiro-sol | `gpt-5.6-sol` | Deployment/contracts/recovery |
| claude-self | `global.anthropic.claude-fable-5-1` | Auth/data/API/ADR |

`kiro-fable` means Opus. `ROLES` governs specialists; legacy files govern legacy
execution. Kiro/Bedrock IDs differ. English is requested, not validated; configured
IDs do not attest model weights.

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

Codex/Claude are required for reviewable source; trusted routing may deactivate
irrelevant Kiro roles. App Router React is conservative. Failed output is never
N/A. Parsing misses whole omissions/some cut prefixes: verify Git scope/hashes.

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

Exit 2 means blocked. Aggregate exit 0: `deterministic` permits the report when no
blocking candidate/uncertainty exists (Minor/Info remain); `review` needs a chair.
Blocked input yields deterministic FAIL; the chair cannot waive coverage failures.

Publish scrubbed reports/receipts/metadata only; never raw `roles/*.diff` or
`requests/*.input/.prompt`.
The executor strips transport controls only, then gives `record` the JSON response
through a mode-0600 temporary file outside the review workspace, removed after
recording even on errors. Transport normalization does not scrub credentials or
change valid JSON/path values.
Diagnostics remain scrubbed; protocol validation preserves source paths before
redacting response evidence.

## Limits and checks

Limits: 95,000 diff bytes (UTF-8), 3,000 lines, 24,000 context bytes, <128 KiB
request; projects may lower them. Oversize blocks. No chunk coordinator or
combining partial PASS results; preserve custody/budgets.
`CHAIR_PANEL_TOTAL_CAP` retains the legacy default and override (200,000 UTF-8
bytes by default), covering specialist-summary bytes only, not diff/context.
Oversized summaries produce FAIL before any chair call, without truncation.

Run `python3 -m unittest discover -s scripts/pr-review -p 'test_*role*.py'`.
Offline CI: `.github/workflows/pr-review-roles-tests.yml`. Activation also needs
executor/adapter, limit and exact-HEAD publication tests; offline success proves
no live provider execution.

ADP retains existing Sol (Terra is historical, ADR-013). Its `run-specialists.sh`
wrapper defaults `REVIEW_CONTEXT_CAP` to 12,288 and accepts only 1–12,288; lower
overrides are supported. The generic `prepare_roles.py` interface retains its
24,000-byte default. Direct protocol calls for ADP must use `--context-cap 12288`
or a lower limit.
Record/aggregate also validate private issued-frame files. Distributed consumers
must restore them from trusted inputs/receipts before aggregation, never publish them.

Valid historical Critical/Major findings and uncertainties remain in adjudication;
a clean retry cannot discard them or establish current-role coverage.

Exclusions-only review requires both `--allow-exclusions-only --policy FILE`.
The trusted BASE collector supplies a schema-1 policy; its exact bytes must match
`input_policy_sha256`. The private `exclusions-policy.json` anchor is rechecked
during aggregation. Missing or mismatched opt-in blocks. The collector, not this
offline library, must establish complete Git scope and approved exclusions.

Valid historical Critical/Major candidates and uncertainties remain subject to
adjudication after reissue; old attempts never provide current-role coverage.

The model table targets CI's Bedrock Runtime provider. Local Mantle uses
`openai.gpt-6-astra` for Astra; provider-specific identifiers are not interchangeable.

React edits retain `kiro-sol`; altered or missing receipt-bound history blocks.

Chair Markdown redacts complete nested/multiline containers, respecting quoted
and escaped delimiters. Syntax is parsed without evaluation; malformed, unclosed
or unsupported container syntax consumes the remaining reply and cannot leave a
valid verdict. Conditional, concatenated, called, indexed or continued expression
tails are also rejected rather than treating the first container as the complete
value. Supported standalone containers preserve the outside verdict. A transient
model throttle may use the configured fallback; account/monthly/credit limits
independently prevent publishing success or invoking a fallback.

## Executor inputs and limits

- `run-specialists.sh`: project entrypoint; ADP defaults `REVIEW_CONTEXT_CAP` to
  12,288 bytes and rejects zero, invalid or larger overrides before preparation.
- `prepare_roles.py`: immutable Git scope, BASE instructions and candidate-size
  checks. `role-input-scope.json` supplies the existing BASE exclusion patterns.
- `prepare_context_roles.py`: optional BASE-byte-verified context hook. Absent in
  ADP; repositories that install it may only lower the supplied context cap.
- `role-project.json`: optional schema-1 execution policy naming
  `prepare_project_roles.py`, `context_sources` and the bounded `chair` settings.
  The adapter must match BASE bytes. ADP uses the generic collector, not this hook.
- `run_role.py`: `PANEL_TIMEOUT` defaults to 300 seconds (maximum 900),
  `PANEL_RETRIES` to 2 (maximum 3), and `KIRO_PREFLIGHT_TIMEOUT` to 60 seconds
  (maximum 120). Workflow overrides remain within these bounds.
- `synthesize_roles.py`: retains `CHAIR_*` settings from the legacy synthesis
  script unless an explicit project policy supplies stricter limits. Hard
  account/monthly/credit limits stop even if a lower-level classifier is silent.
- `role-controls.sh`: forwards to the canonical `lib.sh` control stripper.
  Transport normalization does not invoke credential scrubbing; responses stay
  private until protocol validation and redaction.
