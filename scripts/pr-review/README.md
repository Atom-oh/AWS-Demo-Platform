# Specialist review protocol

Offline library: no Git fetch or model calls. Legacy review stays live;
executor/adapter activation requires separate review.

| Tag | Requested model | Responsibility |
| --- | --- | --- |
| `codex` | `global.openai.gpt-6-astra` | Implementation, concurrency, tests |
| `kiro-fable` | `claude-opus-5` | AWS, IAM, networking |
| `kiro-sol` | `gpt-5.6-sol` | Deployment, contracts, recovery |
| `claude-self` | `global.anthropic.claude-fable-5-1` | Auth, data, API, ADRs |

`kiro-fable` means Opus; Kiro aliases differ from Bedrock IDs. `ROLES` owns
specialists; roster files own legacy execution. English is requested, not
validated. Configuration does not attest model weights.

## Commands and custody

Use `python3 scripts/pr-review/role_review.py COMMAND --help` for flags.

- `prepare`: diff/context, HEAD/base, work, optional paths/provenance →
  `role-plan.json`, `roles/TAG.txt/.diff`; invalidates old results.
- `issue`: work/tag → fresh nonce, `requests/TAG.prompt/.input`,
  `slot/TAG-request.json`; required before each attempt.
- `record`: tag, output/stderr, exit code, issued `--nonce` → validated,
  scrubbed `slot/TAG-result.json`.
- `aggregate`: results/receipts → `role-summary.json`, `responded.txt`,
  `chair-mode.txt` and applicable flag/report.

Executors read the nonce from the receipt and send exact issued bytes.
Record/aggregate compare saved frames with receipts and reconstructed frames;
missing/changed files block. Distributed consumers privately restore these files
from trusted inputs. Hashes bind inputs/results, not transport. Collectors own
source completeness: parsing cannot detect every omitted file or cut prefix.

Never upload raw `roles/*.diff` or `requests/*.input/.prompt`. Upload selected
scrubbed reports, receipts and safe source metadata only. Credential container
text is conservatively redacted through the end of that string.

## Inputs and coverage

`--paths`: UTF-8 JSON array of unique repository-relative patch paths. Renames use
destinations; collectors check both sides. Omit only for authoritative patch paths.

`--provenance`: JSON object with `head_sha`/`base_sha` matching the lowercase 40-hex
CLI revisions and `diff_sha256` hashing raw diff bytes. Optional `input_failures`
codes match `[a-z][a-z0-9_:.-]{0,63}`; any code blocks. Invalid provenance is
discarded and blocks; persisted values are scrubbed. Optional `path_only: list[str]`
permits verified metadata-only deletions, never arbitrary omissions.

Codex/Claude remain required across families for reviewable source. Trusted
routing may deactivate clearly irrelevant Kiro roles. JSX/TSX retains Sol contract
review; App Router components retain both. Failed/missing/stale/invalid output
never means N/A.

Only an existing BASE-approved exclusions-only policy permits all roles
NOT_APPLICABLE and PASS without models. Collectors verify the policy and all Git
paths. Provenance requires `scope_exception: "configured_exclusions_only"`, a
lowercase 64-hex `input_policy_sha256`, and matching nonempty, unique, safe
`scope_paths`/`excluded_paths`. Supply an empty diff and explicit empty JSON array
file for `--paths`. Reports disclose excluded paths/hash and claim no model review.
Other empty input blocks. New exclusions need review; retain project rules.

## Attempts and outcomes

Start with fresh work. `prepare` clears owned results, receipts, timings, claims,
histories, duplicate/terminal flags and summaries; upstream flags remain. Old
frames lack valid receipts. Duplicate records preserve the first result and block;
finish all writers before aggregation.

Reissue validates the prior receipt, archives up to 32 results in
`slot/TAG-attempts.json`, and binds its digest into the new receipt. Missing or
shortened history blocks. Model-selection/fallback/quota/preflight failures stay
blocking until new preparation. Summaries retain history; valid historical
Critical/Major candidates and uncertainties require revalidation/adjudication.
Clean retries cannot erase them or yield automatic PASS.

All work-tree `*.flag` files block except the engine's root `coverage-severe.flag`.
`failure_codes` is canonical (`failures` aliases it). Exit 2 blocks. After aggregate
exit 0, `chair-mode.txt` is `deterministic` for complete results without blocking
candidates/uncertainty (Minor/Info remain), otherwise `review`. Blocked input yields
FAIL; chairs cannot waive coverage. Scope attestation does not prove absence of bugs.

## Limits and verification

Caps: 95,000 UTF-8 diff bytes, 3,000 lines, 24,000 context bytes, complete request
below 128 KiB. Lower project caps are allowed. Oversized input blocks; no chunk
coordinator or combining separate PASS results. Preserve exclusions/custody/budgets.

Run `python3 -m unittest discover -s scripts/pr-review -p test_role_review.py`.
Offline CI: `.github/workflows/pr-review-roles-tests.yml`. Activation also requires
executor/adapter, limit and exact-HEAD publication checks; tests prove no live
provider success. AWS Demo Platform retains Sol and explicitly passes
`--context-cap 12288`; Terra is historical (ADR-013).
