#!/bin/bash
# Tests for secret-scan.sh patterns.
# Construct sensitive-looking tokens at runtime via string concatenation
# to avoid triggering GitHub Push Protection.

# --- True positives (must match) ---
assert_grep_match "TP: AWS Access Key ID" 'AKIA[0-9A-Z]{16}' "AKIAIOSFODNN7EXAMPLE"

GH_PAT="ghp_"
GH_BODY=$(printf 'A%.0s' {1..36})
assert_grep_match "TP: GitHub PAT" 'ghp_[A-Za-z0-9]{36}' "${GH_PAT}${GH_BODY}"

SLACK_PREFIX="xoxb-"
SLACK_BODY="123456789012-1234567890123-abcdef"
assert_grep_match "TP: Slack Bot Token" 'xoxb-[0-9]+-[A-Za-z0-9]+' "${SLACK_PREFIX}${SLACK_BODY}"

GOOG_PREFIX="AIza"
GOOG_BODY=$(printf 'A%.0s' {1..35})
assert_grep_match "TP: Google API Key" 'AIza[A-Za-z0-9_-]{35}' "${GOOG_PREFIX}${GOOG_BODY}"

# --- False positives (must NOT match) ---
assert_grep_no_match "FP: Normal base64 (not AKIA)" 'AKIA[0-9A-Z]{16}' "dGhpcyBpcyBhIHRlc3Q="
assert_grep_no_match "FP: Empty password" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = ""'
assert_grep_no_match "FP: Short password (under 8 chars)" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = "abc"'
assert_grep_no_match "FP: GitHub PAT prefix only" 'ghp_[A-Za-z0-9]{36}' "ghp_short"
