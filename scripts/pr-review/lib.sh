#!/usr/bin/env bash
# Shared helpers: slot directories, skip logging, panel roster.
set -uo pipefail

# Single source of truth for the panel roster — run-panel.sh and aggregate.sh must read
# this same array or tag mismatches creep in (ADR-013/014). matrix.model in the workflow
# YAML is a separate literal; drift there is caught by aggregate.sh's degraded-model floor
# and out-of-roster tag guard.
# glm-5 (kiro-glm) dropped per ADR-015 (false-positive-prone). Current slots:
# claude-fable-5 (kiro-fable), gpt-5.6-sol (kiro-sol).
KIRO_MODELS=("claude-fable-5:kiro-fable" "gpt-5.6-sol:kiro-sol")
PANEL_TAGS=(codex "${KIRO_MODELS[@]##*:}" claude-self)

# Recreate the slot dir fresh every run so stale cell files from a previous run (on a
# reused, non-ephemeral $WORK) don't leak into the chair's input.
ensure_slots() {
  [ -n "$1" ] || { echo "ensure_slots: \$1(workdir) must not be empty" >&2; return 1; }
  # TOCTOU guard: refuse if $WORK or $WORK/slot is a symlink.
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

# Last line of defense, not prevention (ADR-002 residual risk) — strips credential
# patterns from cell output before the chair sees it. Reuses co-agent's
# `consensus_hooks.py::_SECRET_RE` set plus EKS Pod Identity JWT detection.
scrub_secrets() {
  # Awk state machine, not line-oriented sed: PEM bodies span multiple lines.
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
