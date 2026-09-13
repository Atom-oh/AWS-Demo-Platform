---
description: Run code review on current changes with confidence-based filtering
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*)
---

# Code Review

Review the current code changes using confidence-based scoring.

## Step 1: Get Changes

Determine the scope of review:

- If $ARGUMENTS specifies files, review those files
- Otherwise, review unstaged changes: `git diff`
- If no unstaged changes, review staged changes: `git diff --cached`

## Step 2: Review

Read `CLAUDE.md`, the nearest module guide and `.claude/skills/code-review/SKILL.md`.
Use `docs/pr-review.md` for reviewer context and ADR applicability. Identify
introduced defects with code evidence; do not infer missing guards from a partial
diff or impose proposed controls as existing requirements.

## Step 3: Score and Filter

Rate each issue 0-100. Only report issues with confidence >= 75.

## Step 4: Output

Present findings in structured format with file paths, line numbers, and fix suggestions.
State the reviewed scope and remaining uncertainty if no findings survive verification.

## Error Recovery

### If no changes found (Step 1)
- Check if changes are committed: `git log -1 --oneline`
- Check if on the right branch: `git branch --show-current`
- Suggest specifying files directly: `/review path/to/file`

### If CLAUDE.md is missing or empty (Step 2)
- Run `/project-init:init-project` to generate scaffolding
- Or create a minimal CLAUDE.md with conventions section

### If diff is too large (>500 lines)
Focus on high-risk files first:
1. Files with IAM/SG changes (security-sensitive)
2. Files with Terraform state-affecting changes
3. ArgoCD Application sync policy changes
4. Documentation changes (lower priority)
