# PR review contract

The current specialist protocol is defined in [specialist review](pr-review-specialists.md)
and implemented by [.github/workflows/pr-review.yml](../.github/workflows/pr-review.yml)
and [scripts/pr-review](../scripts/pr-review/). [ADR-020](decisions/ADR-020-specialist-review-protocol.md)
replaces repeated L2-L5 reviews and permissive dropout thresholds. ADR-016 still
owns shared context and runner images; ADR-015 still explains per-model job isolation.

## Project-specific inputs

Same-repository PRs targeting `main` run trusted event-base scripts. Every job
uses immutable base/head SHAs and the merge-base change boundary. Both revisions
must contain `AGENTS.md`: nonempty, at most 12,288 bytes, and with a matching
canonical-source hash when generated. `CLAUDE.md` cannot replace a missing digest.
Missing, oversized or stale context blocks preparation. Only the
base context instructs reviewers; candidate documents remain diff data. Local Kiro
steering points to that digest, but CI explicitly embeds it because Kiro has no tools.

The specialist path reviews complete approved Git source under the trusted BASE
input-scope policy. Exclusions are recorded; prefixes never receive full credit. Oversize or incomplete input blocks. Four
per-model jobs retain read-only GitHub permissions; the final job aggregates
validated role artifacts and publishes. Its model subprocess receives no GitHub
token. Native base scripts adopt a workflow change only after it merges.

Kiro uses an explicit empty catalog and a fixed no-PR-data canary before each
active model. `--trust-tools=` alone is not a no-tools control. Failed startup,
model selection, provider or quota checks do not count as review completion.
The existing runner provider configuration is retained.
`kiro-fable` is the compatibility tag for `claude-opus-5`; `kiro-sol` uses
`gpt-5.6-sol`, not the old GPT-5.5 selection. `role_review.py` declares specialist
model IDs; legacy `lib.sh` roster values apply only to legacy fixtures.

## Review evidence

Report introduced defects with a changed path, concrete failure condition,
impact and supporting evidence. Missing unchanged hunks do not prove a guard is
absent. The local checkout is base code, not head code. Live deployment status
requires separate observations. Accepted non-production trade-offs remain valid
unless a change worsens them.

Use [ADR applicability](decisions/README.md), current module guides and scoped
runbooks. Historical designs and partially superseded decisions do not create
new requirements. Developer documentation, comments and reviews are English;
localized dashboard strings and their assertions may remain Korean.

Before merge check current-head AI findings and inline comments, complete required
coverage, relevant tests, actual branch rules and the intended integration path.
A green job or a generic PASS is insufficient. Follow [review and release](runbooks/review-and-release.md)
and preserve quotas and required gates. Remaining safeguards in the old
[gate-hardening proposal](superpowers/specs/2026-08-09-pr-review-gate-hardening-design.md)
are proposals unless evidenced by implementation.

## Verification

Run `bash tests/run-all.sh` and
`python3 -m unittest discover -s scripts/pr-review -p 'test_*role*.py' -v`.
Offline subprocess tests use fake CLIs and spend no model credits. They establish
protocol behavior, not provider availability or review quality. Revalidate the
installed CLI after changes and inspect exact-head live artifacts before merge.

Startup checks and explicit no-tools profiles preserve the protections documented
in [the review runbook](runbooks/pr-review-panel.md); selected-role failures block.
