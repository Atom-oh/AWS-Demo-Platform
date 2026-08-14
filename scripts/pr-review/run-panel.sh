#!/usr/bin/env bash
# Runs only one model's lens×model cells. Args: <diff> <lenses_dir> <workdir> <model_tag>
# model_tag: codex | kiro-fable | kiro-sol | claude-self (see lib.sh PANEL_TAGS)
# Each *.txt in lenses_dir is one lens (filename stem = lens tag, e.g. L2/L3/L4/L5) —
# that lens's dedicated review prompt (self-contained: "look only at this lens"). The
# workflow calls this script 5 times, once per per-model parallel job (matrix.model), so
# one invocation runs only that model's full set of lenses (4 cells) — concurrent
# processes per pod 20 -> 4, each job uploads only its own cell results as an artifact, and
# the chair job's aggregate.sh merges the 5 artifacts for the final aggregation/floor
# verdict.
# The diff-delivery path differs per CLI: Codex/Claude self-review use stdin (direct
# `< "$DIFF"` redirect, a file so not a TTY -> no-hang); Kiro ignores stdin and is given no
# tools at all, so (see the Kiro-cell comment below) the diff is embedded directly as
# size-capped argv text. A timeout backstop + non-interactive flags prevent hangs. If a
# cell comes back empty, retry up to PANEL_RETRIES times (absorbs transients such as
# codex's gpt-5.6-sol/bedrock-mantle). Re-runs on every attempt.
# One model's 4 lenses run in parallel (&+wait) — wall clock ~= the single slowest lens,
# not the sequential sum.
set -uo pipefail
DIFF="$(realpath "$1" 2>/dev/null)" \
  || { echo "run-panel.sh: realpath failed to resolve diff path: $1" >&2; exit 1; }
LENSES_DIR="$2"; WORK="$3"; MODEL_TAG="$4"
# Same principle as precheck.sh — if $WORK is empty, ensure_slots' `rm -rf "$1/slot"`
# becomes the destructive path `rm -rf /slot` (under the filesystem root). An empty
# $LENSES_DIR isn't destructive (the glob just matches nothing and silently ends up with
# 0 cells), but catching a misconfigured argument immediately is better for debugging
# than letting it pass silently.
[ -n "$LENSES_DIR" ] || { echo "run-panel.sh: lenses_dir (\$2) must not be empty" >&2; exit 1; }
[ -n "$WORK" ] || { echo "run-panel.sh: workdir (\$3) must not be empty" >&2; exit 1; }
[ -n "$MODEL_TAG" ] || { echo "run-panel.sh: model_tag (\$4) must not be empty" >&2; exit 1; }
# $SLOT (="$WORK/slot") is still referenced as-is in the Kiro cell even after
# `cd "$CELL_CWD"` — if the caller passes a relative WORK, it breaks from that point on.
# The current callers (the workflow) all pass absolute paths, so this wasn't an actual
# bug, but as with DIFF, we make the code itself guarantee it by resolving to an absolute
# path here.
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

# Kiro cells are granted no tools at all (`--trust-tools=`, below) — a previous revision
# granted `fs_read` and passed only the diff path, letting Kiro read it itself, but that
# had two problems: (1) the diff is untrusted PR content, so a prompt injection inside it
# could induce "instead of that path, read the absolute path ~/.aws/credentials" (an
# isolated cwd/HOME does not by itself block an absolute-path read — oh-my-cloud-skills
# review round 19 CRITICAL, demonstrated live that Kiro actually reads absolute-path repo
# files even from an isolated cwd). (2) Even if the model never makes the `fs_read` call
# (or is blocked by the sandbox), it can still produce a plausible-looking non-empty
# response like "no findings" — so as long as the coverage floor (aggregate.sh) only
# detects empty slots, a cell that never actually saw the diff gets silently counted as a
# normal response (cc-on-bedrock PR#107 review MAJOR-1). Granting no tools at all and
# passing the diff directly via argv structurally removes both problems at once — there's
# no read call needed, so it can't be skipped, and with no tools granted there's no
# absolute-path read path to begin with.
# That `--trust-tools=` (empty value) means "no tools" is documented by kiro-cli itself
# (`kiro-cli chat --help`): "trust no tools: '--trust-tools='" — quoted verbatim from its
# example text (version: kiro-cli 2.11.1, reconfirmed with a live repro — an injected
# "read /etc/passwd" instruction was refused). If kiro-cli ever changes this semantic in
# the future, this fail-closed assumption needs to be re-verified.
# Isolation is still kept as a separate subdirectory per lens (same pattern as co-agent's
# PR gate `_review_one`/`_sanitized_env`) — removing tools and isolating are two orthogonal
# decisions: since one model's 4 lenses run concurrently (&), sharing one cell's cwd/HOME
# could let kiro-cli's session/cache state race across the parallel runs (a regression
# from the fs_read-removal refactor, where this got re-described merely as "prevents
# cross-run leakage" and the race-prevention purpose silently dropped — caught by this PR's
# own review via 4-model cross-model consensus). Even if $WORK is reused on a
# non-ephemeral runner, the base is reset at the start of every run so that the previous
# run's kiro-cwd state doesn't leak into the new run.
KIRO_CWD_BASE="$WORK/kiro-cwd"
[ -L "$KIRO_CWD_BASE" ] && { echo "run-panel.sh: \$KIRO_CWD_BASE is a symlink, refusing (TOCTOU guard)" >&2; exit 1; }
rm -rf "$KIRO_CWD_BASE"; mkdir -p "$KIRO_CWD_BASE"
kiro_env() {
  local cell_cwd="$1"; shift
  env -i PATH="$PATH" HOME="$cell_cwd" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" TMPDIR="${TMPDIR:-/tmp}" \
    ${KIRO_API_KEY:+KIRO_API_KEY="$KIRO_API_KEY"} "$@"
}

# The diff is embedded directly as size-capped argv text — capped below the kernel's
# single-argv 128KiB limit (MAX_ARG_STRLEN). The reasons argv embedding was originally
# avoided (that limit, `ps` exposure) aren't a real tradeoff here: (1) we apply the same
# PANEL_CELL_CAP capping convention to the diff input too, truncating it below the limit,
# and (2) this diff is a PR diff from a public repo, already public on GitHub, so `ps`
# visibility isn't a new secret exposure (it isn't an actual secret). Only prepared when
# the tag is a Kiro tag.
KIRO_TAG=""
for entry in "${KIRO_MODELS[@]}"; do
  [ "${entry##*:}" = "$MODEL_TAG" ] && KIRO_TAG="$MODEL_TAG" && KIRO_MODEL_ID="${entry%%:*}"
done

if [ -n "$KIRO_TAG" ]; then
  KIRO_DIFF_CAP="${KIRO_DIFF_CAP:-100000}"
  KIRO_DIFF_TEXT="$(head -c "$KIRO_DIFF_CAP" "$DIFF")"
  # Truncation itself is harmless (an intentional tradeoff for large diffs), but if it
  # passes without any signal, the Kiro cell — having seen only a prefix — still gets
  # counted as a normal response, silently violating the contract that "coverage signal
  # should reflect whether a vendor actually saw only part of the diff" — pass a flag file
  # so synthesize.sh can call this out explicitly in the review body.
  if [ "$(wc -c < "$DIFF")" -gt "$KIRO_DIFF_CAP" ]; then
    KIRO_DIFF_TEXT+=$'\n[...TRUNCATED at '"$KIRO_DIFF_CAP"'B — full diff not sent to Kiro...]'
    echo "::warning::diff exceeds KIRO_DIFF_CAP (${KIRO_DIFF_CAP}B) — Kiro cells only see a truncated prefix" >&2
    # Placed inside $SLOT (previously at the $WORK root) — the panel job uploads only the
    # single $SLOT directory as its artifact, so if this flag file lived outside $SLOT,
    # upload-artifact's LCA (least common ancestor) would shift depending on whether the
    # file exists, changing the artifact's internal structure from run to run (PR#88
    # review CRITICAL — diagnosis: in the ordinary case where the diff is under
    # KIRO_DIFF_CAP, this file doesn't exist at all, so the LCA collapses to $SLOT itself,
    # and the chair's aggregate.sh can't find $SLOT and fails every run). Keeping it inside
    # $SLOT always uploads the same single directory, so the structure stays fixed
    # regardless of whether the file exists.
    : > "$SLOT/kiro-diff-truncated.flag"
  fi
fi

for lens_file in "${LENS_FILES[@]}"; do
  lens="$(basename "$lens_file" .txt)"
  LENS_PROMPT="$(cat "$lens_file")"

  # if/elif instead of case — re-listing the Kiro tags in a branch (the old
  # `kiro-fable|kiro-sol)`) creates yet another copy of the KIRO_MODELS list. Adding a
  # third Kiro model to the roster once caused a regression where that copy didn't match
  # any arm, and that model's cells silently came back as 0 (PR#88 review MINOR) — branch
  # only on $KIRO_TAG (already derived above by iterating KIRO_MODELS; an empty string
  # means this tag isn't Kiro), eliminating one of the roster copies.
  if [ "$MODEL_TAG" = codex ]; then
    # Codex cell (Bedrock, config.toml). --skip-git-repo-check is required. AWS_REGION is
    # forced: gpt-5.6-sol (bedrock-mantle) only supports In-Region (us-east-1) — pin it
    # regardless of the job's region. diff goes via stdin.
    if command -v codex >/dev/null 2>&1; then
      ( try_panel "$SLOT/codex-$lens.md" "$SLOT/codex-$lens.err" \
          env AWS_REGION="${CODEX_AWS_REGION:-us-east-1}" AWS_DEFAULT_REGION="${CODEX_AWS_REGION:-us-east-1}" \
          timeout "$T" codex exec -s read-only --skip-git-repo-check "$LENS_PROMPT" ) &
    else echo "[skip] codex/$lens (binary absent)" >&2; : > "$SLOT/codex-$lens.md"; fi
  elif [ -n "$KIRO_TAG" ]; then
    # Kiro cell. Kiro's non-interactive `chat` reads ONLY the prompt arg — it ignores
    # stdin, so the diff is embedded directly in argv (capped, no tools granted — see the
    # KIRO_DIFF_TEXT/`--trust-tools=` comments above).
    KIRO_INSTRUCTION="$LENS_PROMPT"$'\n\n'"Review ONLY the diff below; do not read or reference any other files:"$'\n\n'"$KIRO_DIFF_TEXT"
    if command -v kiro-cli >/dev/null 2>&1; then
      CELL_CWD="$KIRO_CWD_BASE/$MODEL_TAG-$lens"; mkdir -p "$CELL_CWD"
      ( cd "$CELL_CWD" && try_panel "$SLOT/$MODEL_TAG-$lens.md" "$SLOT/$MODEL_TAG-$lens.err" \
          kiro_env "$CELL_CWD" timeout "$T" kiro-cli chat "$KIRO_INSTRUCTION" --model "$KIRO_MODEL_ID" \
          --mode default --no-interactive --trust-tools= --wrap never ) &
    else echo "[skip] $MODEL_TAG/$lens (binary absent)" >&2; : > "$SLOT/$MODEL_TAG-$lens.md"; fi
  elif [ "$MODEL_TAG" = claude-self ]; then
    # Claude self-review cell (the panel's 4th member — a quirk specific to this repo) —
    # an independent review (a separate voice from the chair) on the plugin-equipped
    # container. Same as Codex, diff goes via stdin (`claude -p` reads stdin normally, so
    # there's no need to force it through Kiro's fs_read path). --allowedTools is pinned
    # to read-only GitHub context tools.
    if command -v claude >/dev/null 2>&1; then
      CLAUDE_SELF_PROMPT="$LENS_PROMPT

[Claude self-review — running on the plugin-equipped runner]
- If needed, use read-only tools (gh pr diff/view, gh search, Read/Grep/Glob, github MCP
  where available) to check files/PR context beyond the diff directly.
- code-review methodology: focus on real bugs, logic errors, security, CLAUDE.md violations.
  Exclude minor nitpicks, anything a linter/type-checker would catch, pre-existing issues, and
  problems on lines the PR didn't touch. Discard false positives.
- Output findings only, grouped CRITICAL/MAJOR/MINOR. Do not post any GitHub comment and do
  not output a VERDICT line.
Respond in English only (token/context efficiency — do not mix in other languages)."
      ( try_panel "$SLOT/claude-self-$lens.md" "$SLOT/claude-self-$lens.err" \
          timeout "$T" claude -p "$CLAUDE_SELF_PROMPT" --output-format text \
            --allowedTools "Read Grep Glob Bash(gh pr diff:*) Bash(gh pr view:*) Bash(gh search:*) Bash(gh issue view:*) mcp__github__get_file_contents mcp__github__search_code mcp__github__get_pull_request mcp__github__list_commits" ) &
    else echo "[skip] claude-self/$lens (binary absent)" >&2; : > "$SLOT/claude-self-$lens.md"; fi
  fi
done

# NOTE: Antigravity (agy) was removed — OAuth interactive login only (no API-key auth
# mode), so it can't authenticate in headless CI. Panel = Codex + Kiro x3 + Claude
# self-review -> Claude chair.
wait

# Aggregation (responded.txt/degraded-*/coverage-severe) does not happen here — this
# script only knows about one model's cells. After all 5 parallel jobs finish, the chair
# job merges the artifacts and renders the verdict via aggregate.sh.

# Surface the reason for a skip: if a slot is empty but stderr has content, print the end
# of stderr (the actual error) to the log. Since this is a public repo, anyone can read
# these Actions logs — run it through the same scrub_secrets() used for synthesize.sh's
# cells, to prevent accidental credential exposure that could leak via the stderr
# (error messages/stack traces) path.
for e in "$SLOT"/*.err; do
  [ -s "$e" ] || continue
  b="$(basename "$e" .err)"
  [ -s "$SLOT/$b.md" ] && continue   # skip if the response succeeded
  echo "--- [$b] skipped; stderr (last 25 lines, scrubbed) ---" >&2
  tail -25 "$e" | scrub_secrets >&2
done
