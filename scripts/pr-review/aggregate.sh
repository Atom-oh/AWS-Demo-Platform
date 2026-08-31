#!/usr/bin/env bash
# Aggregates artifacts from the 4 panel jobs (downloaded by the chair job into
# $WORK/slot) and applies the coverage-floor verdict. Args: <lenses_dir> <workdir>
# Coverage floor requires the full 4-model set, so it can only run here (not in run-panel.sh).
set -uo pipefail
LENSES_DIR="$1"; WORK="$2"
[ -n "$LENSES_DIR" ] || { echo "aggregate.sh: lenses_dir (\$1) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "aggregate.sh: workdir (\$2) must not be empty" >&2; exit 1; }
WORK="$(realpath "$WORK")" || { echo "aggregate.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
SLOT="$WORK/slot"
# A missing $SLOT (all 4 panel jobs failed/cancelled, no artifacts) is treated as "all
# models unresponsive", not a hard failure — otherwise the fail-closed coverage-floor path
# below never runs and the job just ends red with no explanation (PR#88 review MAJOR).
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

# Off-roster tag guard — matrix.model and lib.sh's PANEL_TAGS are separate literals and can
# drift. Checked regardless of file size (not `[ -s ]`): purpose is "does this cell belong
# to the roster", not "did it respond" (PR#88 review MINOR). Opposite drift direction
# (roster entry the matrix never runs) is caught by the degraded-model floor below.
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

# Coverage floor — if a model produces zero responses across all lenses (dead binary, auth
# failure, panel job's pod dying, missing artifact, etc.), warn + record it so
# synthesize.sh can call it out in the review body instead of a silent VERDICT: PASS.
: > "$WORK/degraded-models.txt"
for model_tag in "${PANEL_TAGS[@]}"; do
  # No `|| echo 0` fallback: grep -c exits 1 on zero matches but still prints "0", and a
  # fallback would double it into "0\n0". $RESP always exists, so grep's stdout is enough.
  row_count="$(grep -c "^${model_tag}/" "$RESP" 2>/dev/null)"
  if [ "${row_count:-0}" -eq 0 ]; then
    echo "::warning::model '$model_tag' produced zero responses across all ${#LENS_FILES[@]} lenses — coverage degraded" >&2
    echo "$model_tag" >> "$WORK/degraded-models.txt"
  fi
done

# Escalate to severe (force VERDICT: FAIL via synthesize.sh) only once (total - 1) or more
# models are degraded, i.e. at most 1 vendor survives and cross-lens checking no longer
# holds. A single dropout stays warn-only — common with rate-limits, and other models still
# cross-check that lens.
DEGRADED_COUNT=$(wc -l < "$WORK/degraded-models.txt")
if [ "$DEGRADED_COUNT" -ge "$((TOTAL_MODELS - 1))" ]; then
  echo "::error::coverage collapsed to ≤1 vendor ($DEGRADED_COUNT/$TOTAL_MODELS models degraded) — forcing VERDICT: FAIL, no cross-model check remains for any lens" >&2
  : > "$WORK/coverage-severe.flag"
fi

# Per-lens floor — a lens with zero responses across all models can hide behind the
# per-model floor above (each model's row is non-zero thanks to other lenses). Unlike a
# dead model, there's no other response to cross-check against, so this escalates to
# severe immediately rather than staying warn-only.
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
