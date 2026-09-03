#!/usr/bin/env bash
# Runs pr-review.yml's "Scrub + shrink cell outputs before upload" step verbatim against
# fixtures. The step's own pipeline order is the thing under test, so the block is extracted
# from the workflow rather than restated here — a reordering there must fail this test.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/pr-review.yml"
WORK=""

if ! declare -F pass >/dev/null 2>&1; then
  _t_fail=0
  pass() { echo "  OK $1"; }
  fail() { echo "  FAIL $1 -> ${2:-}"; _t_fail=1; }
fi

cleanup() { [ -n "${WORK:-}" ] && rm -rf "$WORK"; WORK=""; }

WORK=$(mktemp -d)
mkdir -p "$WORK/slot"
STEP="$WORK/scrub-step.sh"
awk '
  /^      - name: Scrub \+ shrink cell outputs before upload$/ { found = 1; next }
  found && /^        run: \|$/ { body = 1; next }
  body && /^          / { sub(/^          /, ""); print; next }
  body && /^[[:space:]]*$/ { print ""; next }
  body { exit }
' "$WORKFLOW" | sed "s#/tmp/pr-review#$WORK#g" > "$STEP"

if [ -s "$STEP" ] && grep -q 'scrub_secrets' "$STEP"; then
  pass "artifact-scrub extracted the workflow scrub step"
else
  fail "artifact-scrub extracted the workflow scrub step" "step body not found in pr-review.yml"
fi

# A token straddling the 4000-bytes-from-end boundary: truncating first cuts off the `ghp_`
# prefix every scrub_secrets pattern is anchored on, publishing the still-secret suffix.
TOKEN="ghp_STRADDLE0123456789abcdefghijklmnopqrs"
{
  head -c 200 /dev/zero | tr '\0' 'A'
  printf '\n%s' "$TOKEN"
  head -c 3990 /dev/zero | tr '\0' 'B'
  printf '\n'
} > "$WORK/slot/codex-L2.err"
# Same threat with a control byte splitting the token, to keep strip-before-scrub covered.
printf 'cell: ghp_CELLTOKEN\033[31m1234567890abcdefghijklmnop\033[0m\n' > "$WORK/slot/codex-L2.md"

GITHUB_WORKSPACE="$ROOT" bash "$STEP" > "$WORK/step.log" 2>&1

if grep -Fq 'ghp_' "$WORK/slot/codex-L2.err"; then
  fail "artifact-scrub .err scrubs before truncating" "token survived into the uploaded artifact"
elif grep -Fq '[REDACTED-GH-TOKEN]' "$WORK/slot/codex-L2.err"; then
  pass "artifact-scrub .err scrubs before truncating"
else
  fail "artifact-scrub .err scrubs before truncating" "redaction marker missing"
fi

ERR_BYTES=$(wc -c < "$WORK/slot/codex-L2.err")
[ "$ERR_BYTES" -le 4000 ] \
  && pass "artifact-scrub .err stays within the 4000-byte upload cap" \
  || fail "artifact-scrub .err stays within the 4000-byte upload cap" "artifact was ${ERR_BYTES}B"

if grep -Fq 'ghp_' "$WORK/slot/codex-L2.md"; then
  fail "artifact-scrub cell strips control bytes before scrubbing" "ANSI-split token survived"
elif grep -Fq '[REDACTED-GH-TOKEN]' "$WORK/slot/codex-L2.md"; then
  pass "artifact-scrub cell strips control bytes before scrubbing"
else
  fail "artifact-scrub cell strips control bytes before scrubbing" "redaction marker missing"
fi

cleanup

if [ "${_t_fail+set}" = set ]; then
  [ "$_t_fail" = 0 ] && echo "PASS: test-artifact-scrub" || exit 1
fi
