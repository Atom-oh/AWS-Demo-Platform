# ADR-016: Multi-AI co-agent PR review panel (Codex + Kiro) with a Claude chair

> Renumbered from ADR-007 (numbering collision with
> [ADR-007-mgmt-observability-internal-nlb-exception](ADR-007-mgmt-observability-internal-nlb-exception.md)).

## Status
Accepted (2026-06-14). Superseded in part by [ADR-011](ADR-011-pr-review-kiro-roster-gpt55-drop-v3.md)
(Kiro roster `kimi-k2.5` → `gpt-5.5`, drop `--v3`) — this document's roster/flag
references below are historical. Execution topology (single-job fan-out) is
superseded by [ADR-015](ADR-015-pr-review-per-model-parallel-jobs.md)
(per-model parallel jobs).

## Context

`pr-review.yml` runs a single `claude` CLI review (Bedrock Opus 4.8) on the
self-hosted `aws-demo-platform-claude-arm` runner and gates the PR on a final
`VERDICT: PASS|FAIL` line. We want a multi-AI panel — Codex and Kiro — to feed a
Claude chair that synthesizes one review, mirroring the `/co-agent review`
pattern. The runner image (`actions-runner-claude`) was previously built outside
this repo; we also fold its build into this repo as the management area
consolidates here.

```mermaid
flowchart LR
  PR[pull_request_target] --> RUN[runner: aws-demo-platform-claude-arm]
  RUN --> P[run-panel.sh parallel + timeout]
  P -->|codex exec, Bedrock us-east-1 gpt-5.5| C[slot/codex.md]
  P -->|kiro-cli --model claude-opus-4.8/kimi-k2.5/glm-5, KIRO_API_KEY| K[slot/kiro-*.md]
  C --> S[synthesize.sh]
  K --> S
  S -->|claude -p, Bedrock ap-northeast-2 Opus 4.8| R[review.md + VERDICT]
  R --> G[fail-closed gate + comment upsert]
```

## Options Considered

### Option 1: Independent verdicts, combined gate
- **Pros**: simple; each AI emits its own VERDICT; gate = AND/majority.
- **Cons**: no synthesis; noisy comment; disagreement handling is mechanical.

### Option 2: Claude chairs & synthesizes (chosen)
- **Pros**: one coherent review; matches `/co-agent`; chair reconciles panel agreement/dissent; single VERDICT keeps the existing fail-closed gate unchanged.
- **Cons**: chair is a single point; 5 model calls/PR latency.

### Option 3: Panel + synthesis, both shown
- **Pros**: transparency of raw panel takes.
- **Cons**: bulky comment; raw panel output rarely actionable vs the synthesis.

## Decision

**Option 2.** Panel = Codex (1) + Kiro (`claude-opus-4.8`, `kimi-k2.5`, `glm-5`).
Panelists emit findings only; **Claude Opus 4.8 is the chair** and produces the
single review + `VERDICT`. Orchestration lives in repo scripts
(`scripts/pr-review/`), not inline YAML. Auth: **Codex uses Bedrock
natively** via baked `~/.codex/config.toml` (`model_provider = "amazon-bedrock"`,
`openai.gpt-5.5`, `us-east-1`) — no key, reusing the runner node IAM, whose
`ci_runner_bedrock` policy is already `Resource=*` (all regions). **Kiro uses
`KIRO_API_KEY`** read from the existing Secrets Manager secret
`/demo-platform/actions/AI-key` via an `external-secrets.io/v1` ExternalSecret
(`ai-panel-keys`) into the runner pod env — no new slot. The runner stays in **ap-northeast-2**
(cross-region Bedrock latency is negligible vs generation time; relocating would
need a new cluster/ECR/secrets in us-east). The runner image is built in this
repo (`docker/actions-runner-claude/` + `runner-image.yml`, ADR-003 OIDC→ECR).

No-hang is guaranteed by non-interactive flags (`codex exec`, `kiro-cli
--no-interactive --trust-tools=read,grep`) + `timeout` + stdin isolation; any
panelist failure/absence is a graceful `[skip]`, and an all-skip degrades to the
prior Claude-solo behavior.

## Consequences

### Positive
- Cross-family review diversity (OpenAI gpt-5.5 + Kiro opus/kimi/glm) with one synthesized verdict.
- Existing gate (fail-closed), comment upsert, and concurrency invariants are untouched.
- Runner image and its build pipeline are now owned and PR-reviewed in this repo.
- No new secret slot — reuses the existing `/demo-platform/actions/AI-key` secret.

### Negative
- Up to 5 model calls per PR (latency; acceptable for non-prod async review).
- Chair is a single synthesis point; a bad chair run still fail-closes via the VERDICT rule.
- `kimi-k2.5` may be account-tier gated → that panelist silently skips.
- Adds an ExternalSecret-syncing ArgoCD Application to operate.

## Update (2026-06-23) — runner image ownership, Kiro v3

Rebased the runner image off the official ARC image (the previous `FROM
actions-runner-claude:latest` was self-referential — a weekly cron would keep
stacking on its own output). Pinned CLI versions (later unpinned — see
[ADR-013](ADR-013-pr-review-gpt56-model-bump.md)), baked Claude Code plugins, and
added a weekly rebuild (`runner-image.yml` schedule, best-effort — a failed build
never reaches `docker push`). Panel calls used `kiro-cli --v3 chat` at this point
(binary `kiro-cli`, never bare `kiro`); `--v3` was dropped later per
[ADR-011](ADR-011-pr-review-kiro-roster-gpt55-drop-v3.md). Dropped Antigravity
(`agy`) — headless API-key auth doesn't work and it requires interactive OAuth.
Fixed a runner-credentials gap: the shared `claude-runner` SA was missing from
`infra/eks-mgmt` `runner_service_accounts`, so pods had no Bedrock access.

## Update (2026-06-23b) — Claude self-review panelist

Added an independent `claude -p` self-review to the panel, using the code-review
methodology and read-only tools to see context beyond the truncated diff — findings
only, no comment/VERDICT authority. The original allowlist included GitHub MCP read
tools; the 2026-08-31 update below replaces them with bounded `gh` commands.
Auth is job-scoped (`github.token`), not a pod-wide PAT; in the
`pull_request_target` write context, tool access is a read-only allowlist (no
`gh api`/comment ability). See
[ADR-010](ADR-010-bedrock-account-data-retention-for-fable-mythos.md) for the
Bedrock data-retention posture behind the `claude-fable-5` chair model. The
chair-primary switch from Opus 4.8 to Fable 5 itself has no ADR of its own —
[ADR-014](ADR-014-pr-review-opus5-model-bump.md) treats it as an unchanged
prior fact when adding the Opus 5 fallback.

## Update (2026-08-31) — bounded GitHub context and chair input hardening

Removed GitHub MCP tools from the Claude self-review and chair allowlists after MCP
authentication failures caused the CLI to wait until the panel or chair timeout. Both
roles retain `Read`/`Grep`/`Glob` and bounded read-only `gh` commands, preserving the
required repository and PR context without depending on MCP startup.

The chair still receives the diff and panel outputs through stdin to stay below the
kernel argv limit. Each run now wraps those inputs in matching unpredictable nonce
boundaries and explicitly treats marker-like text inside the diff block as untrusted
data. ANSI CSI/OSC sequences are removed before credential scrubbing, and stderr is
scrubbed in full before public excerpts are truncated.

Chair generation failure remains fail-closed, but is distinct from a code-finding
failure: an invalid primary and fallback response creates `chair-failed.flag`, while a
successful retry clears any stale flag from a reused work directory. The workflow can
therefore request a rerun without misrepresenting an infrastructure failure as a
confirmed CRITICAL or MAJOR code finding.
