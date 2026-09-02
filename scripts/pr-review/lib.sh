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

# Must run before scrub_secrets on every path that reaches a public log, so a control byte
# can't split a credential past the redaction regexes below while rendering invisibly.
# Ordering inside: named sequences first (their payloads contain bytes the catch-all would
# eat), then any residual ESC, then raw C0/C1 controls — \t\n\r survive, since scrub_secrets
# and the callers' line handling depend on them.
# The OSC payload class excludes ESC as well as BEL: with only BEL excluded, ERE
# leftmost-longest matching spans two ST-terminated OSC-8 sequences and deletes the visible
# text between them (PR#85 review L4).
strip_ansi() {
  # LC_ALL=C: the patterns are byte-exact, and a raw C1 byte is invalid UTF-8 — under a
  # UTF-8 locale sed would not match it as part of a character range.
  LC_ALL=C sed -E \
    -e 's/\x1b\][^\x07\x1b]*(\x07|\x1b\\)//g' \
    -e 's/\x1b\[[0-?]*[ -\/]*[@-~]//g' \
    -e 's/\x1b[()*+][0-~]//g' \
    -e 's/\x1b[@-_]//g' \
    -e 's/\x1b//g' \
    -e 's/\x9d[^\x07\x9c]*(\x07|\x9c)//g' \
    -e 's/\x9b[0-?]*[ -\/]*[@-~]//g' \
    -e 's/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b\x9d]//g'
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
