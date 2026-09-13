#!/usr/bin/env bash
# Unit tests for run-panel.sh (PATH-mocked CLIs; standalone or sourced by run-all.sh).
# Per-model job (ADR-015): 4th arg <model_tag> runs one model's full lens set only;
# responded.txt/degraded-*/coverage-severe now live in aggregate.sh (test-aggregate.sh).
# Roster (lib.sh): codex, kiro-fable (claude-fable-5), kiro-sol (gpt-5.6-sol), claude-self.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$(cd "$HERE/../../scripts/pr-review" && pwd)/run-panel.sh"
ORIGINAL_PATH="$PATH"
# Own these before the first setup's cleanup runs: sourced by run-all.sh, an earlier test
# file's leftover values would otherwise be the rm -rf targets.
WORK=""; BIN=""; LENSES=""

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

cleanup() {
  PATH="$ORIGINAL_PATH"
  export PATH
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  [ -n "${BIN:-}" ] && rm -rf "$BIN"
  [ -n "${LENSES:-}" ] && rm -rf "$LENSES"
  WORK=""; BIN=""; LENSES=""
}

mkfake() { # $1 binname, $2 exitcode, $3 marker
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
if [ "$2" -eq 0 ]; then echo "$3"; cat; else exit $2; fi
EOF
  chmod +x "$BIN/$1"
}

setup() { # $1 = space-separated list of lens tags (default L2)
  cleanup
  WORK=$(mktemp -d); BIN=$(mktemp -d); LENSES=$(mktemp -d)
  PATH="$BIN:$ORIGINAL_PATH"
  export PATH
  echo "diff --git a b" > "$WORK/diff.txt"
  for l in ${1:-L2}; do echo "review lens $l" > "$LENSES/$l.txt"; done
}

# (a) codex tag fills only codex's cells; other models' slots untouched
setup "L2 L3"; mkfake codex 0 "codex-finding"; mkfake kiro-cli 0 "kiro-finding"; mkfake claude 0 "claude-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
allok=1; diffok=1
for f in codex-L2 codex-L3; do
  [ -s "$WORK/slot/$f.md" ] || allok=0
  grep -q "diff --git" "$WORK/slot/$f.md" 2>/dev/null || diffok=0
done
[ "$allok" = 1 ] && pass "run-panel (a) codex tag: both lens cells filled" || fail "run-panel (a) codex tag: both lens cells filled" "a slot is empty"
[ "$diffok" = 1 ] && pass "run-panel (a) diff reached every cell (stdin)" || fail "run-panel (a) diff reached every cell (stdin)" "a cell got empty stdin"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] && [ ! -e "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (a) codex call does not touch other models' slots" \
  || fail "run-panel (a) codex call does not touch other models' slots" "unexpected slot file present"
[ ! -f "$WORK/responded.txt" ] \
  && pass "run-panel (a) no responded.txt written (aggregate.sh's job now)" \
  || fail "run-panel (a) no responded.txt written (aggregate.sh's job now)" "responded.txt unexpectedly created"

# (b) kiro-sol calls kiro-cli with gpt-5.6-sol; sibling kiro-fable slot untouched
setup; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-sol >/dev/null 2>&1
[ -s "$WORK/slot/kiro-sol-L2.md" ] \
  && pass "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" || fail "run-panel (b) kiro-sol tag produces kiro-sol-L2.md" "slot missing/empty"
[ ! -e "$WORK/slot/kiro-fable-L2.md" ] \
  && pass "run-panel (b) sibling kiro tag untouched" || fail "run-panel (b) sibling kiro tag untouched" "kiro-fable slot appeared"

# (c) claude-self: CLI always exits 1 -> empty slot after retries exhaust, non-blocking.
# (Exit-1 stands in for "not installed" since the real `claude` binary is already on PATH here.)
setup; mkfake claude 1 ""
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && [ -f "$WORK/slot/claude-self-L2.md" ] && [ ! -s "$WORK/slot/claude-self-L2.md" ] \
  && pass "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" \
  || fail "run-panel (c) claude-self all-retries-fail -> empty slot, exit 0 (non-blocking)" "rc=$rc"

# (d) unknown model_tag fails loudly (catches matrix.model drift)
setup
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" not-a-real-model >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (d) unknown model_tag fails loudly" || fail "run-panel (d) unknown model_tag fails loudly" "exited 0 with unknown tag"

# (e) empty lenses_dir fails immediately (not silently 0 cells)
setup; rm -f "$LENSES"/*.txt; mkfake codex 0 "codex-finding"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && pass "run-panel (e) empty lenses_dir fails loudly" || fail "run-panel (e) empty lenses_dir fails loudly" "exited 0 with no lens files"

# (f) Claude self-review keeps bounded local/gh read tools but excludes GitHub MCP tools.
setup
export CLAUDE_ARGV_FILE="$WORK/claude-argv.txt"
cat > "$BIN/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CLAUDE_ARGV_FILE"
echo "claude-finding"
cat
EOF
chmod +x "$BIN/claude"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" claude-self >/dev/null 2>&1
if grep -Fq 'mcp__github__' "$CLAUDE_ARGV_FILE"; then
  fail "run-panel (f) Claude self-review argv excludes GitHub MCP tools" "GitHub MCP tool present"
elif grep -Fq 'Read Grep Glob' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh pr diff:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh pr view:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh search:*)' "$CLAUDE_ARGV_FILE" \
  && grep -Fq 'Bash(gh issue view:*)' "$CLAUDE_ARGV_FILE"; then
  pass "run-panel (f) Claude self-review argv uses bounded read-only tools"
else
  fail "run-panel (f) Claude self-review argv uses bounded read-only tools" "expected allowedTools missing"
fi

# (g) A skipped cell's stderr tail goes to the world-readable Actions log, so control
# bytes must be stripped before scrubbing or an escape sequence smuggles the token out.
setup
cat > "$BIN/codex" <<'EOF'
#!/usr/bin/env bash
printf 'boom: ghp_EEEEEEEEEE\033[31m1234567890abcdefghijklmnop\n' >&2
printf 'raw: ghp_FFFFFFFFFF\233m1234567890abcdefghijklmnop\n' >&2
exit 1
EOF
chmod +x "$BIN/codex"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>"$WORK/panel.err"
if grep -Eq 'ghp_(EEEE|FFFF)' "$WORK/panel.err"; then
  fail "run-panel (g) skipped-cell stderr redacts control-byte-split tokens" "plaintext token in log"
elif [ "$(grep -c '\[REDACTED-GH-TOKEN\]' "$WORK/panel.err")" -ge 2 ]; then
  pass "run-panel (g) skipped-cell stderr redacts control-byte-split tokens"
else
  fail "run-panel (g) skipped-cell stderr redacts control-byte-split tokens" "expected 2 redaction markers"
fi

# (h) The 25-line window must be taken after scrubbing: scrub_secrets' PEM redaction
# anchors on the BEGIN line, so a window starting inside the body publishes bare base64.
setup
cat > "$BIN/codex" <<'EOF'
#!/usr/bin/env bash
{
  echo "-----BEGIN RSA PRIVATE KEY-----"
  i=0
  while [ "$i" -lt 40 ]; do echo "MIIEowIBAAKCAQEAxLEAKSECRETBODYLINE$i"; i=$((i + 1)); done
  echo "-----END RSA PRIVATE KEY-----"
} >&2
exit 1
EOF
chmod +x "$BIN/codex"
"$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>"$WORK/panel.err"
if grep -Fq 'SECRETBODYLINE' "$WORK/panel.err"; then
  fail "run-panel (h) skipped-cell stderr scrubs the PEM body before truncating" \
       "private key body reached the public log"
else
  pass "run-panel (h) skipped-cell stderr scrubs the PEM body before truncating"
fi

# Record the actual CLI boundary. The real runner must select an agent and install
# its profile; the fake must not supply either (which would hide default fallback).
mkkiro_recorder() {
  cat > "$BIN/kiro-cli" <<'EOF'
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
agent = args[args.index("--agent") + 1] if "--agent" in args else None
profile = Path.cwd() / ".kiro" / "agents" / f"{agent}.json"
Path("kiro-called").touch()
print(json.dumps({
    "args": args,
    "agent": agent,
    "profile": json.loads(profile.read_text()) if profile.is_file() else None,
    "cwd": str(Path.cwd()),
    "home": os.environ.get("HOME"),
    "fixture_key": os.environ.get("KIRO_API_KEY") == "fixture-only-key",
    "inherited_credentials": any(k in os.environ for k in (
        "GH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    )),
}))
EOF
  chmod +x "$BIN/kiro-cli"
}

# (i) --trust-tools= controls approval, not availability. Both Kiro slots must use
# the named empty-tool profile in every fresh lens directory and retain isolation.
for kiro_entry in "kiro-fable:claude-opus-5" "kiro-sol:gpt-5.6-sol"; do
  kiro_tag="${kiro_entry%%:*}"; kiro_model="${kiro_entry#*:}"
  setup "L2 L3 L4 L5"; mkkiro_recorder
  # Stale local profiles must not survive another attempt in the same workdir.
  mkdir -p "$WORK/kiro-cwd/$kiro_tag-L2/.kiro/agents"
  echo '{"name":"inline-review","tools":["glob"]}' \
    > "$WORK/kiro-cwd/$kiro_tag-L2/.kiro/agents/inline-review.json"
  echo "stale" > "$WORK/kiro-cwd/$kiro_tag-L2/stale-state"
  KIRO_API_KEY=fixture-only-key GH_TOKEN=fixture-only-github \
    AWS_ACCESS_KEY_ID=fixture-only-aws AWS_SECRET_ACCESS_KEY=fixture-only-secret \
    PANEL_RETRIES=1 "$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" "$kiro_tag" \
    >"$WORK/panel.log" 2>"$WORK/panel.err"
  rc=$?
  if [ "$rc" -eq 0 ] && python3 - "$WORK" "$kiro_tag" "$kiro_model" <<'PY'
import json
from pathlib import Path
import sys

work, tag, model = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
for lens in ("L2", "L3", "L4", "L5"):
    observed = json.loads((work / "slot" / f"{tag}-{lens}.md").read_text())
    assert observed["agent"] == "inline-review", f"{tag}/{lens}: default agent selected"
    profile = observed["profile"]
    assert profile is not None, f"{tag}/{lens}: named agent profile missing"
    assert profile["name"] == "inline-review"
    for field, expected in (
        ("tools", []), ("allowedTools", []), ("mcpServers", {}),
        ("resources", []), ("hooks", {}),
    ):
        assert profile.get(field) == expected, f"{tag}/{lens}: {field} is not explicitly empty"
    assert "model" not in profile, "profile must not override the CLI model"
    args = observed["args"]
    assert args[args.index("--model") + 1] == model
    assert "--trust-tools=" in args and "--no-interactive" in args
    assert args[args.index("--mode") + 1] == "default"
    assert args[args.index("--wrap") + 1] == "never"
    assert "review lens " + lens in args[1] and "diff --git a b" in args[1]
    cell = work / "kiro-cwd" / f"{tag}-{lens}"
    assert observed["cwd"] == observed["home"] == str(cell)
    assert observed["fixture_key"] and not observed["inherited_credentials"]
    assert not (cell / "stale-state").exists()
PY
  then
    pass "run-panel (i) $kiro_tag uses an empty-tool agent in all four isolated cells"
  else
    fail "run-panel (i) $kiro_tag uses an empty-tool agent in all four isolated cells" \
      "missing/default profile, tool exposure, changed invocation or leaked environment (rc=$rc)"
  fi
done

# (j) A missing or empty trusted profile must fail before any Kiro invocation.
# Use a copied script tree so the test never removes tracked configuration.
for profile_state in missing empty; do
  setup; mkkiro_recorder
  fixture_dir="$BIN/script-copy"; mkdir -p "$fixture_dir"
  cp "$SCRIPT" "$fixture_dir/run-panel.sh"
  cp "$(dirname "$SCRIPT")/lib.sh" "$fixture_dir/lib.sh"
  [ "$profile_state" = empty ] && : > "$fixture_dir/kiro-inline-review.json"
  PANEL_RETRIES=1 bash "$fixture_dir/run-panel.sh" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-fable \
    >"$WORK/panel.log" 2>"$WORK/panel.err"
  rc=$?
  called="$(find "$WORK" -name kiro-called -print -quit)"
  if [ "$rc" -ne 0 ] && [ -z "$called" ]; then
    pass "run-panel (j) $profile_state agent profile fails before Kiro/default fallback"
  else
    fail "run-panel (j) $profile_state agent profile fails before Kiro/default fallback" \
      "rc=$rc; Kiro invoked=$([ -n "$called" ] && echo yes || echo no)"
  fi
done

# (k) A failed copy must not launch Kiro against an absent/default profile.
setup; mkkiro_recorder
cat > "$BIN/cp" <<'EOF'
#!/usr/bin/env bash
exit 23
EOF
chmod +x "$BIN/cp"
PANEL_RETRIES=1 "$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-sol \
  >"$WORK/panel.log" 2>"$WORK/panel.err"
rc=$?
called="$(find "$WORK" -name kiro-called -print -quit)"
if [ "$rc" -ne 0 ] && [ -z "$called" ]; then
  pass "run-panel (k) profile copy failure prevents Kiro invocation"
else
  fail "run-panel (k) profile copy failure prevents Kiro invocation" "rc=$rc or Kiro was invoked"
fi

# (l) Kiro-profile readiness must not become a dependency of the other model slots.
setup; mkfake codex 0 "codex-finding"
fixture_dir="$BIN/script-copy"; mkdir -p "$fixture_dir"
cp "$SCRIPT" "$fixture_dir/run-panel.sh"
cp "$(dirname "$SCRIPT")/lib.sh" "$fixture_dir/lib.sh"
bash "$fixture_dir/run-panel.sh" "$WORK/diff.txt" "$LENSES" "$WORK" codex >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && [ -s "$WORK/slot/codex-L2.md" ]; then
  pass "run-panel (l) non-Kiro slot works without a Kiro profile"
else
  fail "run-panel (l) non-Kiro slot works without a Kiro profile" "rc=$rc or Codex slot empty"
fi

# (m) Do not reuse a cell's previous configuration when cleanup cannot make it fresh.
setup; mkkiro_recorder
mkdir -p "$WORK/kiro-cwd/kiro-fable-L2/.kiro/agents"
echo '{"name":"inline-review","tools":["glob"]}' \
  > "$WORK/kiro-cwd/kiro-fable-L2/.kiro/agents/inline-review.json"
cat > "$BIN/rm" <<'EOF'
#!/usr/bin/env bash
exit 23
EOF
chmod +x "$BIN/rm"
KIRO_API_KEY=fixture-only-key PANEL_RETRIES=1 \
  "$SCRIPT" "$WORK/diff.txt" "$LENSES" "$WORK" kiro-fable \
  >"$WORK/panel.log" 2>"$WORK/panel.err"
rc=$?
called="$(find "$WORK" -name kiro-called -print -quit)"
if [ "$rc" -ne 0 ] && [ -z "$called" ]; then
  pass "run-panel (m) failed cell cleanup prevents reuse and Kiro invocation"
else
  fail "run-panel (m) failed cell cleanup prevents reuse and Kiro invocation" "rc=$rc or Kiro was invoked"
fi

cleanup
unset CLAUDE_ARGV_FILE

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-run-panel" || exit 1
fi
