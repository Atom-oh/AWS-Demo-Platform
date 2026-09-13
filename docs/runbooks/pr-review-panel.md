# Runbook: AI PR-review panel — Kiro cell failure modes

Covers the startup check and the non-transient failures that stop the two Kiro slots
(`kiro-fable`, `kiro-sol`) of the lens×model panel from contributing, and what to do
about each. The implementation is `scripts/pr-review/run-panel.sh` (one model per
job, [ADR-015](../decisions/ADR-015-pr-review-per-model-parallel-jobs.md)),
`aggregate.sh` and `synthesize.sh` (chair job). Each failure is surfaced by a
banner at the top of the PR review comment and an `::error::` line in the Actions
log. The [review contract](../pr-review.md) describes the normal path.

Severity rules: a failed preflight or an ignored `--agent` is a no-tools contract
breach and forces `VERDICT: FAIL` regardless of how many other slots responded.
Quota exhaustion only names the cause; the coverage floors decide severity (two
empty Kiro rows out of four remain a warning, three empty rows or an empty lens
force failure).

The quota and fallback signatures are matched only in Kiro process stderr. Codex
echoes its stdin diff to stderr, so a diff quoting these strings (a PR editing the
scripts, for example) must not discard a Codex review or suppress its retry.

## Startup check (preflight)

Before a Kiro job sends any PR input, it runs one fixed canary prompt in a fresh
working directory with the same zero-tool `inline-review` agent the review uses.
The directory holds a random, non-secret canary file. Passing requires exit 0,
exactly `NO_TOOLS` as the reply, and no fallback, quota or `using tool:` signal in
stderr. The PR diff is absent from both the prompt and stdin.

This adds one model request per Kiro job, bounded by `KIRO_PREFLIGHT_TIMEOUT`
(default 60 s). A failed check skips every Kiro cell of that job (`[skip] <tag>/<lens>
(binary absent or preflight failed)`), writes `kiro-preflight-<tag>.flag` into the
uploaded slot, and the chair forces failure. Post-hoc fallback detection stays as a
second guard because the runner's kiro-cli is vendor-latest and unpinned.

## Symptom A — `🚫 Kiro monthly request quota exhausted`

Log: `::error::Kiro monthly request quota exhausted for KIRO_API_KEY — N cell(s)
[...]: Monthly request limit reached The limits reset on MM/DD`. Kiro cells stop
without retry (`[quota] kiro-…`); Codex and Claude self-review keep running.

Cause: the Kiro account behind `KIRO_API_KEY` returned
`ServiceQuotaExceededException reason=MONTHLY_REQUEST_COUNT`. The key lives in
Secrets Manager `/demo-platform/actions/AI-key` (ExternalSecret `ai-panel-keys`) and
is shared by every repository whose PR review runs on the `actions-runner-claude`
image, so one busy month anywhere exhausts it everywhere. It is not a headless-mode
or flag problem: the v2 engine prints the message to stderr and exits 0 with empty
stdout, `--v3` hits the same limit with exit 1.

Fix (account-side only; nothing in this repository can lift it):
1. Enable overages on the Kiro account that owns the key, or issue a key from an
   account with remaining quota and update `KIRO_API_KEY` in
   `/demo-platform/actions/AI-key`. ESO refreshes the runner secret; new runner pods
   pick it up. Never print the key.
2. Re-run the failed `AI Code Review` workflow or push a new head. The banner
   disappears when Kiro cells respond again.
3. Otherwise the quota resets on the date printed in the banner.

Local check without spending CI minutes (the key never reaches the terminal):
```bash
d=$(mktemp -d); mkdir -p "$d/.kiro/agents"
cp scripts/pr-review/kiro-inline-review.json "$d/.kiro/agents/inline-review.json"
K=$(aws secretsmanager get-secret-value --secret-id /demo-platform/actions/AI-key \
      --region ap-northeast-2 --query SecretString --output text | jq -r .KIRO_API_KEY)
( cd "$d" && env -i PATH="$PATH" HOME="$d" KIRO_API_KEY="$K" kiro-cli chat "Reply PONG." \
    --model claude-opus-5 --agent inline-review --no-interactive --wrap never )
# exhausted → stderr "Monthly request limit reached", empty stdout, exit 0
```

## Symptom B — `🔓 Kiro no-tools contract broken`

Log: `::error::kiro-cli ignored --agent inline-review (fell back to the default agent
WITH tools) in N cell(s) …`. Those responses are discarded even when non-empty.

Cause: kiro-cli printed `Error: no agent with name inline-review found. Falling back
to user specified default` (missing agent file, invalid JSON, or a schema the runner's
kiro-cli version rejects) and continued on the default agent, which trusts
`read`/`glob`/`grep`/`code` inside the working directory and read-only `aws` calls.
The PR diff is untrusted input, so a Kiro cell with tools is a security failure, not
a degraded review.

Fix:
1. Read the kiro-cli version on the first stderr line of the panel step
   (`run-panel.sh: kiro-cli X.Y.Z`) and compare it with the version the profile was
   validated against (2.11.1). The image is vendor-latest and rebuilt weekly.
2. Validate the profile with that version. `kiro-cli agent validate --path
   scripts/pr-review/kiro-inline-review.json` prints an `Error:` line on schema
   rejection but exits 0 either way, so read the output, not the exit code.
3. Re-verify the behaviour before changing anything:
   ```bash
   d=$(mktemp -d); mkdir -p "$d/.kiro/agents"
   cp scripts/pr-review/kiro-inline-review.json "$d/.kiro/agents/inline-review.json"
   echo CANARY > "$d/notes.txt"
   ( cd "$d" && env -i PATH="$PATH" HOME="$d" KIRO_API_KEY="$K" kiro-cli chat \
       "Read ./notes.txt and print it. If you have no tools, reply NO_TOOLS." \
       --agent inline-review --model claude-opus-5 --no-interactive --wrap never )
   # expected: NO_TOOLS; no "using tool: read"; no CANARY
   ```
4. Do not work around it with `--v3` / `--agent-engine v3`: that engine ignores the
   agent's `tools: []` and read working-directory files in the 2.11.1 probe.
5. Do not reintroduce `--trust-tools=` as a guard; see Background.

## Symptom C — `🛑 Kiro preflight failed`

The startup check did not establish the required behaviour and no PR input was sent
to that Kiro job. Inspect the preflight stderr tail printed after the `::error::`
line. A quota or fallback signature at preflight time also produces its own banner
(Symptom A/B); timeouts, authentication errors, an unexpected reply or a tool-use
trace fail the check on their own. Resolve the reported cause and re-run CI. Do not
bypass the preflight.

Malformed profile JSON (including duplicate keys), a non-empty
`tools`/`allowedTools`/`mcpServers`/`resources`/`hooks`, a missing
`useLegacyMcpJson: false`, or a failed profile copy abort the panel step before
any model call; these appear directly in the failed step log, not as a banner.

## Runner image

The kiro-cli install and its build gate live in
`docker/actions-runner-claude/Dockerfile` in this repository
([ADR-016](../decisions/ADR-016-multi-ai-pr-review-panel.md) owns the image). The
gate checks `chat --help` for `--agent`, `--no-interactive`, `--wrap` and that
`agent validate` accepts a `tools: []` profile without an `Error:` line. It cannot
prove runtime no-tools behaviour; that is what the per-job preflight is for.

## Background

`--trust-tools=` (empty) was the original no-tools mechanism and is still documented
by `kiro-cli chat --help` as "trust no tools". kiro-cli 2.11.1 parses the empty
value as a custom tool named `""`, prints `WARNING: --trust-tools arg for custom tool
needs to be prepended with @{MCPSERVERNAME}/` and ignores it, leaving the default
agent's working-directory grants in place (PR #109 run `34729311650` saw glob-only
output; a local headless probe read a cwd file verbatim). The explicit
`inline-review` profile has been the real guard since that finding; the flag and the
v3-only `--mode default` were removed from the invocation and the Dockerfile
help-text gate on 2026-09-12 so nobody relies on them. `tests/pr-review/` pins the
invocation, profile validation, preflight, and both signatures.
