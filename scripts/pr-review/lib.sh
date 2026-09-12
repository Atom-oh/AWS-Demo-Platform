#!/usr/bin/env bash
# Shared helpers: slot directories, skip logging, panel roster.
set -uo pipefail

# Single source of truth for the panel roster — run-panel.sh and aggregate.sh must read
# this same array or tag mismatches creep in (ADR-013/014). matrix.model in the workflow
# YAML is a separate literal; drift there is caught by aggregate.sh's degraded-model floor
# and out-of-roster tag guard.
# glm-5 (kiro-glm) dropped per ADR-015 (false-positive-prone). Current slots:
# claude-opus-5 (legacy kiro-fable tag), gpt-5.6-sol (kiro-sol).
# Kiro rejected claude-fable-5.1 as nonexistent in Actions run 34698223622.
# claude-opus-5 returned READY in a local kiro-cli 2.11.1 probe and L2-L5
# review responses; see ADR-014's 2026-09-12 update for evidence and tag compatibility.
KIRO_MODELS=("claude-opus-5:kiro-fable" "gpt-5.6-sol:kiro-sol")
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
# A UTF-8-aware byte state machine, not sed byte classes: 0x9b and 0x9d are C1 introducers
# but ALSO legitimate UTF-8 continuation bytes, so a byte-oriented rule deletes real text —
# `이` is EC 9D B4, and a 0x9d..0x9c rule swallows everything up to the 9C ending `한`
# (PR#85 review L4). Valid UTF-8 sequences are emitted untouched, so only bytes that cannot
# be part of one are read as controls; that also makes it safe to cover every C1 introducer
# rather than just CSI/OSC. Tab, LF and CR survive — scrub_secrets and the callers' line
# handling depend on them. Invalid bytes that are not C0/C1 pass through: they cannot
# introduce a sequence, and scrub_secrets stays the last line of defense.
# awk parses record-at-a-time, so control-string state does not survive a newline: a
# multiline OSC/DCS payload is emitted as text from its second line on. That direction is
# safe — the text reaches scrub_secrets contiguously and no open control string remains for
# a renderer to hide it in. Do NOT make the state span lines downstream of scrubbing; that
# would let a payload swallow the redaction markers instead.
strip_ansi() {
  LC_ALL=C awk '
    BEGIN {
      for (i = 0; i < 256; i++) ORD[sprintf("%c", i)] = i
      # Second-byte bounds rejecting overlong forms, surrogates and out-of-range code
      # points — accepting them would let a crafted sequence carry a C1 byte past this
      # validity check to a renderer that decodes it leniently.
      LO[224] = 160; HI[224] = 191; LO[237] = 128; HI[237] = 159
      LO[240] = 144; HI[240] = 191; LO[244] = 128; HI[244] = 143
    }
    function b(i) { return ORD[substr(L, i, 1)] }
    function seqlen(i,   v, need, lo, hi, k) {
      v = b(i)
      if (v >= 194 && v <= 223) need = 1
      else if (v >= 224 && v <= 239) need = 2
      else if (v >= 240 && v <= 244) need = 3
      else return 0
      if (i + need > N) return 0
      lo = (v in LO) ? LO[v] : 128
      hi = (v in HI) ? HI[v] : 191
      if (b(i + 1) < lo || b(i + 1) > hi) return 0
      for (k = 2; k <= need; k++) if (b(i + k) < 128 || b(i + k) > 191) return 0
      return need + 1
    }
    function csi(i,   j) {   # parameter bytes, intermediates, one final byte
      j = i
      while (j <= N && b(j) >= 48 && b(j) <= 63) j++
      while (j <= N && b(j) >= 32 && b(j) <= 47) j++
      if (j <= N && b(j) >= 64 && b(j) <= 126) j++
      return j
    }
    # Terminator forms: BEL, raw ST, ESC-backslash, and ST as its UTF-8 encoding C2 9C.
    # Payload bytes are stepped over a whole UTF-8 sequence at a time, so a continuation
    # byte that happens to be 0x9c (`한` = ED 95 9C) is not mistaken for a terminator.
    function esc_final(i,   j) {   # intermediates 0x20-0x2f then one final byte 0x30-0x7e
      j = i
      while (j <= N && b(j) >= 32 && b(j) <= 47) j++
      if (j <= N && b(j) >= 48 && b(j) <= 126) j++
      return j
    }
    function ctlstr(i,   j, m) {
      j = i
      while (j <= N) {
        if (b(j) == 7 || b(j) == 156) return j + 1
        if (b(j) == 27 && j < N && b(j + 1) == 92) return j + 2
        if (b(j) == 194 && j < N && b(j + 1) == 156) return j + 2
        m = seqlen(j)
        j += (m ? m : 1)
      }
      return j
    }
    {
      L = $0; N = length(L); out = ""; i = 1
      while (i <= N) {
        # C2 80-C2 9F is structurally valid UTF-8 AND the canonical encoding of U+0080-U+009F,
        # i.e. the same C1 controls handled in raw-byte form below. Checked before seqlen or
        # it is emitted as ordinary text, re-opening the invisible credential split: browsers
        # render Cc code points as nothing and UTF-8 terminals decode them as controls
        # (PR#85 review L3). No legitimate text encodes these code points.
        if (b(i) == 194 && i < N && b(i + 1) >= 128 && b(i + 1) <= 159) {
          w = b(i + 1)
          if (w == 155) i = csi(i + 2)
          else if (w == 157 || w == 144 || w == 152 || w == 158 || w == 159) i = ctlstr(i + 2)
          else i += 2
          continue
        }
        n = seqlen(i)
        if (n) { out = out substr(L, i, n); i += n; continue }
        v = b(i)
        if (v == 27) {
          w = (i < N) ? b(i + 1) : -1
          if (w == 91) i = csi(i + 2)
          else if (w == 93 || w == 80 || w == 88 || w == 94 || w == 95) i = ctlstr(i + 2)
          else if (w >= 40 && w <= 43) i += 3
          else if (w >= 64 && w <= 95) i += 2
          # Remaining ESC forms (ESC 7, ESC c, ESC # 8): optional intermediates then a
          # final byte. Without this the residue is emitted as visible text.
          else i = esc_final(i + 1)
        }
        else if (v == 155) i = csi(i + 1)
        else if (v == 157 || v == 144 || v == 152 || v == 158 || v == 159) i = ctlstr(i + 1)
        else if (v == 9 || v == 13) { out = out substr(L, i, 1); i++ }
        else if (v < 32 || v == 127 || (v >= 128 && v <= 159)) i++
        else { out = out substr(L, i, 1); i++ }
      }
      print out
    }
  '
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
