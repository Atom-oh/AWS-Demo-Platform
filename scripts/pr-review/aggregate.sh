#!/usr/bin/env bash
# Aggregates the artifacts from the 4 panel jobs (downloaded by the chair job into
# $WORK/slot) and applies the coverage-floor verdict. Args: <lenses_dir> <workdir>
# run-panel.sh can no longer make this determination, since it now only knows its own
# model's cells — this is only possible once the full 4-model set is gathered in one
# place (i.e. here, in the chair job).
set -uo pipefail
LENSES_DIR="$1"; WORK="$2"
[ -n "$LENSES_DIR" ] || { echo "aggregate.sh: lenses_dir (\$1) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "aggregate.sh: workdir (\$2) must not be empty" >&2; exit 1; }
WORK="$(realpath "$WORK")" || { echo "aggregate.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
SLOT="$WORK/slot"
# The absence of $SLOT (i.e. $SLOT itself doesn't exist) is treated the same as
# "all models unresponsive" rather than a hard failure — if all 4 panel jobs fail/are
# cancelled and there are no artifacts at all, the download-artifact step's
# continue-on-error lets execution reach here, but previously this used to exit 1,
# meaning aggregate.sh itself never ran. That left no coverage-severe.flag, no forced
# FAIL banner, and no comment upsert — the job just ended red, meaning the fail-closed
# path that ADR-015 promises ("the coverage floor decides, and the reason is visible in
# the review body") was unreachable in the worst case (PR#88 review MAJOR). By creating
# an empty slot and continuing, the degraded-model floor below catches the 4/4
# model-missing case and sets coverage-severe.flag as normal.
mkdir -p "$SLOT"
RESP="$WORK/responded.txt"; : > "$RESP"
rm -f "$WORK/coverage-severe.flag"

shopt -s nullglob
LENS_FILES=("$LENSES_DIR"/*.txt)
shopt -u nullglob
if [ "${#LENS_FILES[@]}" -eq 0 ]; then
  echo "aggregate.sh: no *.txt lens files found in $LENSES_DIR" >&2
  exit 1
fi

# Off-roster tag guard — if matrix.model drifts from lib.sh's PANEL_TAGS (both are
# separate workflow/script literals, so they can drift), an unknown-tag file shows up in
# the merged slot. The opposite direction (in the roster but the matrix doesn't run it)
# is caught by the degraded-model floor below.
# Checked regardless of file size — skipping empty files with [ -s ] would let a drifted
# tag pass silently every time it responds with an empty cell (PR#88 review MINOR): this
# guard's purpose is "does the cell that exists belong to the roster", not "did that cell
# respond".
for f in "$SLOT"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f" .md)"
  tag="${base%-*}"
  known=0
  for t in "${PANEL_TAGS[@]}"; do [ "$tag" = "$t" ] && known=1 && break; done
  if [ "$known" -eq 0 ]; then
    echo "::error::aggregate.sh: cell '$base' has unknown model tag '$tag' — not in PANEL_TAGS (${PANEL_TAGS[*]}); matrix.model/lib.sh roster drift?" >&2
    exit 1
  fi
done

# Aggregate results (tags are derived from the same source as KIRO_MODELS/LENS_FILES → prevents hardcoded mismatches)
for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  record_result "$SLOT/codex-$lens.md" "codex/$lens" "$RESP"
  for entry in "${KIRO_MODELS[@]}"; do
    tag="${entry##*:}"; record_result "$SLOT/$tag-$lens.md" "$tag/$lens" "$RESP"
  done
  record_result "$SLOT/claude-self-$lens.md" "claude-self/$lens" "$RESP"
done
TOTAL_MODELS=${#PANEL_TAGS[@]}
echo "Panel responded ($(wc -l < "$RESP") / $(( TOTAL_MODELS * ${#LENS_FILES[@]} )) cells): $(tr '\n' ' ' < "$RESP")"

# Coverage floor — if a single model (invalidated flag / binary missing / full auth
# failure / that panel job's pod dying, etc.) produces no responses across all lenses,
# the matrix could silently shrink without that model and still end up at VERDICT: PASS.
# If a model's row is entirely empty, warn + pass a file so synthesize.sh can call it out
# explicitly in the review body. (Side benefit of the job split: if a panel job dies and
# its artifact is missing entirely, that model's cells are all missing too → this floor
# catches it the same way.)
: > "$WORK/degraded-models.txt"
for model_tag in "${PANEL_TAGS[@]}"; do
  # grep -c prints "0" and exits 1 even when there are zero matches (no match = "failure"
  # from grep's perspective) — appending a `|| echo 0` fallback can regress into that "0"
  # being followed by the fallback's own "0", producing "0\n0". $RESP is always created
  # above, so a "file missing" fallback is unnecessary in the first place — just use grep's
  # stdout as-is.
  row_count="$(grep -c "^${model_tag}/" "$RESP" 2>/dev/null)"
  if [ "${row_count:-0}" -eq 0 ]; then
    echo "::warning::model '$model_tag' produced zero responses across all ${#LENS_FILES[@]} lenses — coverage degraded" >&2
    echo "$model_tag" >> "$WORK/degraded-models.txt"
  fi
done

# Severity escalation — if the number of degraded models is (total - 1) or more, at
# most 1 vendor survives, so the warn-only premise ("the matrix itself cross-checks per
# lens" — i.e. other models still see the same lens) no longer holds. Only in this case do
# we escalate to severe, leaving a signal for synthesize.sh to force VERDICT: FAIL (a
# single model dropping out still stays warn-only — that's common with intermittent
# rate-limits, and since the remaining models still cross-check each lens, the original
# design decision from when this PR was introduced — that a human noticing via the banner
# alone is sufficient — remains valid).
DEGRADED_COUNT=$(wc -l < "$WORK/degraded-models.txt")
if [ "$DEGRADED_COUNT" -ge "$((TOTAL_MODELS - 1))" ]; then
  echo "::error::coverage collapsed to ≤1 vendor ($DEGRADED_COUNT/$TOTAL_MODELS models degraded) — forcing VERDICT: FAIL, no cross-model check remains for any lens" >&2
  : > "$WORK/coverage-severe.flag"
fi

# Per-lens floor — the per-model floor above only checks "did this model die across all
# lenses". Conversely, even if one lens is entirely empty (across all models), a model's
# row may still be non-zero (thanks to responses for other lenses) and pass the check
# above — that lens went unreviewed by anyone, yet the matrix looks fine. Why the
# model-floor stays warn-only up to (total - 1) dropouts while this one goes severe
# immediately: when one model dies, the other models still cross-check that lens, but
# when a lens is entirely empty, no vendor looked at it at all — this isn't "one leg of
# the cross-check got weaker", it's "the cross-check doesn't exist at all" — there's
# nothing to mitigate against (no other model's response), so warn-only can't be
# justified.
: > "$WORK/degraded-lenses.txt"
for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  lens_count="$(grep -c "/${lens}$" "$RESP" 2>/dev/null)"
  if [ "${lens_count:-0}" -eq 0 ]; then
    echo "::warning::lens '$lens' produced zero responses across all models — this lens was not reviewed" >&2
    echo "$lens" >> "$WORK/degraded-lenses.txt"
    : > "$WORK/coverage-severe.flag"
  fi
done
