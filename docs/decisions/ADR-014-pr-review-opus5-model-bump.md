# ADR-014: Anthropic review models and catalog recovery

## Status

Accepted (2026-07-28), amended 2026-09-09 and 2026-09-12. Applies to Anthropic model
selection and access-path verification. Current configured values are in
[PR review](../pr-review.md); source is `scripts/pr-review/lib.sh`, `synthesize.sh`
and `.github/workflows/pr-review.yml`. Historical model labels below are not
instructions to revert those files.

## Original decision (2026-07-28)

Replace the then-current Kiro Opus 4.8 slot and Bedrock chair fallback with Opus 5;
leave the Fable chair primary unchanged. Local Kiro execution and Bedrock profile
listing were recorded independently. Kiro's preview/credit labels were catalog
observations on that date, not durable availability, maturity or price guarantees.
The slot was then named `kiro-opus`; ADR-015 later renamed it `kiro-fable`.

## Update (2026-09-09): global profiles and endpoint pairing

The chair primary and Claude self-review moved to
`global.anthropic.claude-fable-5-1`; fallback moved to
`global.anthropic.claude-opus-5`. Claude's endpoint and `AWS_REGION` moved together
to `ap-northeast-2`. The global profile controls model routing; it does not remove
SigV4 endpoint/signing-region agreement. A draft that removed the region was
corrected before propagation (cc-on-bedrock PR #114).

Kiro was separately changed to its dotted catalog spelling `claude-fable-5.1`.
That Kiro availability assertion was superseded by the next amendment; the Bedrock
chair choices were not. Do not interchange Kiro aliases and Bedrock profile IDs.

Codex independently moved to `global.openai.gpt-6-astra` with the
`amazon-bedrock-runtime` provider in its baked config (commit `c7a41bb`). The
current Codex invocation has no extra per-cell region override. This observation
does not change Claude's endpoint/signing configuration.

## Update (2026-09-12): Kiro catalog recovery

Actions run `34698223622` rejected `claude-fable-5.1` through Kiro. PR #104 restored
`claude-opus-5` while preserving the **legacy `kiro-fable` slot tag**. The tag is
used by workflow dispatch, artifacts and aggregation; it is not a literal model
name. The other slot remains `gpt-5.6-sol:kiro-sol`.

Dated evidence recorded in PR #104:

- Kiro CLI 2.11.1 returned `READY` for an Opus probe, then returned L2–L5 supplemental
  review responses with exit 0 for head `3fe0811b55ef0c8a7ef042e691c6cf20c9007129`.
- The `kiro-sol` artifact in run `34698223622` contained L2–L5 responses for head
  `ecddf170553c5d7afd52539fcb7170162d75eefe`.

These establish execution/coverage for those revisions, not clean findings or
later-head approval. Native PR #104 ran base scripts, so supplemental evidence was
needed until the repair merged. Ephemeral local `/tmp` files are not durable proof;
use the PR's recorded evidence and reverify when needed.

Opus through Kiro can overlap the chair fallback's model family through Bedrock;
agreement is not independent corroboration by itself. The recovery changed no
budgets, retry limits, tool restrictions or coverage rules.
