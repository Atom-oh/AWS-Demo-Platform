#!/usr/bin/env bash
# Runs only one model's lens×model cells. Args: <diff> <lenses_dir> <workdir> <model_tag>
# model_tag: codex | kiro-fable | kiro-sol | claude-self (see lib.sh PANEL_TAGS)
# Each *.txt in lenses_dir is one lens (filename stem = lens tag, e.g. L2/L3/L4/L5). The
# workflow calls this script once per per-model parallel job (ADR-015); the chair job's
# aggregate.sh merges all jobs' artifacts for the final verdict.
# Diff delivery differs per CLI: Codex/Claude self-review read stdin; Kiro ignores stdin
# and gets no tools, so the diff is embedded as size-capped argv text (see Kiro-cell
# comment below). A timeout backstop + non-interactive flags prevent hangs; an empty slot
# is retried up to PANEL_RETRIES times.
# One model's 4 lenses run in parallel (&+wait) — wall clock ~= the slowest lens.
set -uo pipefail
DIFF="$(realpath "$1" 2>/dev/null)" \
  || { echo "run-panel.sh: realpath failed to resolve diff path: $1" >&2; exit 1; }
LENSES_DIR="$2"; WORK="$3"; MODEL_TAG="$4"
# If $WORK were empty, ensure_slots' `rm -rf "$1/slot"` would become `rm -rf /slot`.
[ -n "$LENSES_DIR" ] || { echo "run-panel.sh: lenses_dir (\$2) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "run-panel.sh: workdir (\$3) must not be empty" >&2; exit 1; }
[ -n "$MODEL_TAG" ] || { echo "run-panel.sh: model_tag (\$4) must not be empty" >&2; exit 1; }
# $SLOT (="$WORK/slot") is referenced after `cd "$CELL_CWD"` in the Kiro cell, so WORK
# must be absolute or it breaks from that point on.
mkdir -p "$WORK" || { echo "run-panel.sh: failed to create workdir: $WORK" >&2; exit 1; }
WORK="$(realpath "$WORK")" \
  || { echo "run-panel.sh: realpath failed to resolve workdir: $WORK" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK" || exit 1
SLOT="$WORK/slot"
case " ${PANEL_TAGS[*]} " in
  *" $MODEL_TAG "*) ;;
  *) echo "run-panel.sh: unknown model_tag '$MODEL_TAG' (expected one of: ${PANEL_TAGS[*]})" >&2; exit 1 ;;
esac
T="${PANEL_TIMEOUT:-300}"
RETRIES="${PANEL_RETRIES:-3}"

shopt -s nullglob
LENS_FILES=("$LENSES_DIR"/*.txt)
shopt -u nullglob
if [ "${#LENS_FILES[@]}" -eq 0 ]; then
  echo "run-panel.sh: no *.txt lens files found in $LENSES_DIR" >&2
  exit 1
fi

# Run one cell up to $RETRIES times — retry if the slot comes back empty (transient).
# Called in the background.
#   try_panel <slot> <err> <cmd...>   (stdin=$DIFF, stdout=slot, stderr=err)
try_panel() {
  local slot="$1" err="$2"; shift 2
  local a
  for a in $(seq 1 "$RETRIES"); do
    "$@" > "$slot" 2>"$err" < "$DIFF" || true
    [ -s "$slot" ] && break
    [ "$a" -lt "$RETRIES" ] && echo "[retry $a/$RETRIES] $(basename "$slot" .md)" >&2
  done
}

# Kiro cells get no tools at all (`--trust-tools=`, below) and the diff via argv instead
# of `fs_read`: the diff is untrusted PR content, and an isolated cwd/HOME does not block
# an absolute-path read (Kiro will follow a prompt-injected "read ~/.aws/credentials"
# even from an isolated cwd) — with no tools granted, there's no read path to exploit.
# `--trust-tools=` (empty value) = "no tools", per `kiro-cli chat --help` (kiro-cli
# 2.11.1); re-verify this assumption if kiro-cli changes that semantic.
# Each lens still gets its own cwd subdirectory: since one model's 4 lenses run
# concurrently (&), sharing one cwd/HOME would let kiro-cli's session/cache state race
# across the parallel runs. The base is reset at the start of every run.
KIRO_CWD_BASE="$WORK/kiro-cwd"
[ -L "$KIRO_CWD_BASE" ] && { echo "run-panel.sh: \$KIRO_CWD_BASE is a symlink, refusing (TOCTOU guard)" >&2; exit 1; }
rm -rf "$KIRO_CWD_BASE"; mkdir -p "$KIRO_CWD_BASE"
kiro_env() {
  local cell_cwd="$1"; shift
  env -i PATH="$PATH" HOME="$cell_cwd" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" TMPDIR="${TMPDIR:-/tmp}" \
    ${KIRO_API_KEY:+KIRO_API_KEY="$KIRO_API_KEY"} "$@"
}

# Embedded as size-capped argv text, capped below the kernel's single-argv 128KiB limit
# (MAX_ARG_STRLEN). `ps` exposure isn't a new risk here: this diff is already public on
# GitHub. Only prepared when the tag is a Kiro tag.
KIRO_TAG=""
for entry in "${KIRO_MODELS[@]}"; do
  [ "${entry##*:}" = "$MODEL_TAG" ] && KIRO_TAG="$MODEL_TAG" && KIRO_MODEL_ID="${entry%%:*}"
done

if [ -n "$KIRO_TAG" ]; then
  KIRO_DIFF_CAP="${KIRO_DIFF_CAP:-100000}"
  KIRO_DIFF_TEXT="$(head -c "$KIRO_DIFF_CAP" "$DIFF")"
  # Flag the truncation so synthesize.sh can call it out explicitly, rather than letting
  # a Kiro cell that only saw a prefix silently count as a normal response.
  if [ "$(wc -c < "$DIFF")" -gt "$KIRO_DIFF_CAP" ]; then
    KIRO_DIFF_TEXT+=$'\n[...TRUNCATED at '"$KIRO_DIFF_CAP"'B — full diff not sent to Kiro...]'
    echo "::warning::diff exceeds KIRO_DIFF_CAP (${KIRO_DIFF_CAP}B) — Kiro cells only see a truncated prefix" >&2
    # Must live inside $SLOT: the panel job uploads only $SLOT as its artifact, and a flag
    # file outside it would shift upload-artifact's LCA depending on whether the file
    # exists, breaking aggregate.sh's ability to find $SLOT (PR#88 review CRITICAL).
    : > "$SLOT/kiro-diff-truncated.flag"
  fi
fi

for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  LENS_PROMPT="$(cat "$lens_file")"

  # Branch on $KIRO_TAG (derived above from KIRO_MODELS) rather than re-listing Kiro tags
  # here — re-listing them created a second copy that silently drifted out of sync when a
  # Kiro model was added/renamed (PR#88 review MINOR).
  if [ "$MODEL_TAG" = codex ]; then
    # AWS_REGION is forced: gpt-5.6-sol (bedrock-mantle) only supports us-east-1.
    if command -v codex >/dev/null 2>&1; then
      ( try_panel "$SLOT/codex-$lens.md" "$SLOT/codex-$lens.err" \
          env AWS_REGION="${CODEX_AWS_REGION:-us-east-1}" AWS_DEFAULT_REGION="${CODEX_AWS_REGION:-us-east-1}" \
          timeout "$T" codex exec -s read-only --skip-git-repo-check "$LENS_PROMPT" ) &
    else echo "[skip] codex/$lens (binary absent)" >&2; : > "$SLOT/codex-$lens.md"; fi
  elif [ -n "$KIRO_TAG" ]; then
    # Kiro's non-interactive `chat` ignores stdin and reads only the prompt arg.
    KIRO_INSTRUCTION="$LENS_PROMPT"$'\n\n'"Review ONLY the diff below; do not read or reference any other files:"$'\n\n'"$KIRO_DIFF_TEXT"
    if command -v kiro-cli >/dev/null 2>&1; then
      CELL_CWD="$KIRO_CWD_BASE/$MODEL_TAG-$lens"; mkdir -p "$CELL_CWD"
      ( cd "$CELL_CWD" && try_panel "$SLOT/$MODEL_TAG-$lens.md" "$SLOT/$MODEL_TAG-$lens.err" \
          kiro_env "$CELL_CWD" timeout "$T" kiro-cli chat "$KIRO_INSTRUCTION" --model "$KIRO_MODEL_ID" \
          --mode default --no-interactive --trust-tools= --wrap never ) &
    else echo "[skip] $MODEL_TAG/$lens (binary absent)" >&2; : > "$SLOT/$MODEL_TAG-$lens.md"; fi
  elif [ "$MODEL_TAG" = claude-self ]; then
    # Independent Claude review (separate voice from the chair). --allowedTools is pinned
    # to bounded local and gh read-only context tools; GitHub MCP auth failures can hang startup.
    if command -v claude >/dev/null 2>&1; then
      CLAUDE_SELF_PROMPT="$LENS_PROMPT

[Claude self-review — running on the plugin-equipped runner]
- If needed, use read-only tools (gh pr diff/view, gh search, Read/Grep/Glob) to check
  files/PR context beyond the diff directly.
- code-review methodology: focus on real bugs, logic errors, security, CLAUDE.md violations.
  Exclude minor nitpicks, anything a linter/type-checker would catch, pre-existing issues, and
  problems on lines the PR didn't touch. Discard false positives.
- Output findings only, grouped CRITICAL/MAJOR/MINOR. Do not post any GitHub comment and do
  not output a VERDICT line.
Respond in English only (token/context efficiency — do not mix in other languages)."
      ( try_panel "$SLOT/claude-self-$lens.md" "$SLOT/claude-self-$lens.err" \
          timeout "$T" claude -p "$CLAUDE_SELF_PROMPT" --output-format text \
            --allowedTools "Read Grep Glob Bash(gh pr diff:*) Bash(gh pr view:*) Bash(gh search:*) Bash(gh issue view:*)" ) &
    else echo "[skip] claude-self/$lens (binary absent)" >&2; : > "$SLOT/claude-self-$lens.md"; fi
  fi
done

# NOTE: Antigravity (agy) was removed — OAuth interactive login only, can't authenticate
# in headless CI. Panel = Codex + 2 Kiro models + Claude self-review -> Claude chair.
wait

# Aggregation happens in aggregate.sh (chair job), not here — this script only knows
# about one model's cells.

# On a skip, surface stderr's tail to the log — scrubbed, since Actions logs on this
# public repo are world-readable.
for e in "$SLOT"/*.err; do
  [ -s "$e" ] || continue
  b="$(basename "$e" .err)"
  [ -s "$SLOT/$b.md" ] && continue   # skip if the response succeeded
  echo "--- [$b] skipped; stderr (last 25 lines, scrubbed) ---" >&2
  # Truncate last: scrub_secrets' PEM state machine anchors on the BEGIN line, and its
  # other patterns on a token's prefix, so a window that starts mid-secret loses the
  # anchor and publishes the rest verbatim.
  strip_ansi < "$e" | scrub_secrets | tail -25 >&2
done
