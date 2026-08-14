#!/usr/bin/env bash
# Shared helpers: slot directories, skip logging, panel roster.
# (trigger: PR to verify the ADR-015 panel×4 + chair topology actually runs on main)
set -uo pipefail

# Single source of truth for the panel roster. run-panel.sh (cell execution) and
# aggregate.sh (aggregation/floor verdict) must read the same array, or tag mismatches
# creep in (mitigates the "model id lives in multiple places" problem flagged by
# ADR-013/014). The workflow's matrix.model list is still a separate YAML literal, i.e. a
# copy, but drift there is caught from both directions by aggregate.sh's degraded-model
# floor (present in the roster but missing) and the out-of-roster tag guard (present only
# in the matrix, not in the roster).
# glm-5 (kiro-glm) was dropped from the roster per the PR#88 review — in that same run,
# this model alone produced 4 false positives (a nonexistent subshell bug, a claim that
# KIRO_MODEL_ID — which is actually always set — was unset, a claim that the stdin
# redirect already present inside `try_panel` didn't exist, etc.) — the call was that more
# models doesn't mean better signal; more false positives just erodes review trust.
# The two remaining slots were swapped from claude-opus-5/gpt-5.6-terra to
# claude-fable-5/gpt-5.6-sol — the top-tier models in the Kiro catalog (`kiro-cli chat
# --list-models`, measured live against kiro-cli 2.11.1) — and the tags were renamed to
# match the actual models: kiro-opus/kiro-gpt -> kiro-fable/kiro-sol.
# claude-fable-5 is marked in the catalog as "[Internal] DEVELOPMENT USE CASES ONLY, NOT
# FOR CUSTOMER DATA, ITAR OR PII", but this repo already uses the same model as the chair
# primary (ADR-016) on this exact same PR diff, so it's not a new exposure category.
# Credit cost: claude-fable-5 4.40x, gpt-5.6-sol 2.40x (up from the old slots'
# claude-opus-5 2.20x, gpt-5.6-terra 1.00x) — accepted explicitly.
KIRO_MODELS=("claude-fable-5:kiro-fable" "gpt-5.6-sol:kiro-sol")
PANEL_TAGS=(codex "${KIRO_MODELS[@]##*:}" claude-self)

# Guarantee the slot directory — since $WORK can be reused on a non-ephemeral runner,
# empty it and recreate it fresh every time, so leftover cell files from a previous run
# don't leak into the new run's chair input. The sole caller (run-panel.sh) already guards
# against an empty $WORK string, but per precheck.sh's principle, a function that builds a
# destructive path like `rm -rf "$1/slot"` guards against it internally too.
ensure_slots() {
  [ -n "$1" ] || { echo "ensure_slots: \$1(workdir) must not be empty" >&2; return 1; }
  # TOCTOU guard — if another job/process preempts the fixed $WORK path on a
  # non-ephemeral runner with a symlink, `rm -rf` would follow the realpath and could
  # delete under the symlink's target.
  [ -L "$1" ] && { echo "ensure_slots: \$1(workdir) is a symlink, refusing" >&2; return 1; }
  [ -L "$1/slot" ] && { echo "ensure_slots: \$1/slot is a symlink, refusing" >&2; return 1; }
  rm -rf "$1/slot"; mkdir -p "$1/slot"
}

# Evaluate one panel run's result and record it in responded.
#   $1 slot file path, $2 panel label, $3 responded file
record_result() {
  local slot="$1" label="$2" responded="$3"
  if [ -s "$slot" ]; then
    echo "$label" >> "$responded"
  else
    echo "[skip] $label" >&2
    : > "$slot"  # guarantee an empty slot
  fi
}

# Scrub credential patterns — this is the last line of defense, not prevention. To break
# the chain of Kiro's residual fs_read risk (diff injection -> absolute-path read ->
# credential exposure in cell output -> chair synthesis -> leak into a public PR comment
# or an external Kiro service), regex-substitute common credential formats out of cell
# output before handing it to the chair. The patterns reuse co-agent's
# `consensus_hooks.py::_SECRET_RE` (AWS/GitHub/Slack/OpenAI·Anthropic/Google + generic
# key=value) and add detection for EKS Pod Identity tokens (the value at a fixed-path file
# is itself in JWT format). This does not block the absolute-path read itself (scrubbing
# only works *after* the value has actually appeared in the cell's output), so residual
# risk remains — explicitly noted in ADR-002.
scrub_secrets() {
  # PEM spans multiple lines, so a line-oriented sed can't erase the body (it would only
  # match the header line) — use an awk state machine to replace the entire BEGIN..END
  # block with a single marker line (first stage, structural scrub).
  awk '
    BEGIN { skip = 0 }
    /^-----BEGIN [A-Z ]*PRIVATE KEY-----/ { print "[REDACTED-PRIVATE-KEY]"; skip = 1; next }
    skip && /^-----END [A-Z ]*PRIVATE KEY-----/ { skip = 0; next }
    skip { next }
    { print }
    END { if (skip) print "[REDACTED-UNTERMINATED-PEM-BLOCK]" }
  ' | sed -E \
    -e 's/A(KIA|SIA)[0-9A-Z]{16}/[REDACTED-AWS-KEY]/g' \
    -e 's/gh[pousr]_[A-Za-z0-9]{30,}/[REDACTED-GH-TOKEN]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{30,}/[REDACTED-GH-TOKEN]/g' \
    -e 's/xox[abprs]-[A-Za-z0-9-]{10,}/[REDACTED-SLACK-TOKEN]/g' \
    -e 's/(^|[^A-Za-z0-9_])sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}/\1[REDACTED-API-KEY]/g' \
    -e 's/AIza[0-9A-Za-z_-]{30,}/[REDACTED-GOOGLE-KEY]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED-JWT]/g' \
    -e 's/(AUTHORIZATION:[[:space:]]*(basic|bearer)[[:space:]]+)[A-Za-z0-9+\/=_.~-]{20,}/\1[REDACTED-GIT-CRED-HEADER]/gI' \
    -e 's/((api[_-]?key|aws_secret_access_key|aws_access_key_id|access[_-]?token|client[_-]?secret|secret|passwd|password|token)['"'"'"]?[[:space:]]*[:=][[:space:]]*['"'"'"])[^'"'"'"]{8,}(['"'"'"])/\1[REDACTED]\3/gI' \
    -e 's/((^|[^A-Za-z0-9_])(api[_-]?key|aws_secret_access_key|aws_access_key_id|access[_-]?token|client[_-]?secret|secret|passwd|password|token)[[:space:]]*[:=][[:space:]]*)[A-Za-z0-9/+_-]{16,}/\1[REDACTED]/gI'
}
