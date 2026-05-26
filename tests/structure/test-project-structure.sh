#!/bin/bash
# Validates AWS Demo Platform project structure integrity:
# manifests, file existence, command frontmatter, CLAUDE.md sections.

# --- Manifest validation ---
assert_json_valid "settings.json is valid JSON" ".claude/settings.json"
assert_json_valid ".mcp.json is valid JSON" ".mcp.json"

# --- File existence ---
assert_file_exists "Root CLAUDE.md" "CLAUDE.md"
assert_file_exists "README.md" "README.md"
assert_file_exists "CHANGELOG.md" "CHANGELOG.md"
assert_file_exists "docs/architecture.md" "docs/architecture.md"
assert_file_exists "docs/onboarding.md" "docs/onboarding.md"
assert_file_exists "ADR template" "docs/decisions/.template.md"
assert_file_exists "Runbook template" "docs/runbooks/.template.md"

# --- Module CLAUDE.md files (per source root) ---
for module in infra k8s argocd-apps projects dashboard; do
    assert_file_exists "$module/CLAUDE.md exists" "$module/CLAUDE.md"
done

# --- Script validation ---
assert_file_executable "setup.sh is executable" "scripts/setup.sh"
assert_bash_syntax "setup.sh valid bash" "scripts/setup.sh"
assert_file_executable "install-hooks.sh is executable" "scripts/install-hooks.sh"
assert_bash_syntax "install-hooks.sh valid bash" "scripts/install-hooks.sh"

# --- Command frontmatter ---
for cmd in review test-all deploy; do
    assert_file_exists "Command file: $cmd.md" ".claude/commands/$cmd.md"
    CMD_CONTENT=$(cat ".claude/commands/$cmd.md")
    assert_contains "Command $cmd: has frontmatter description" "$CMD_CONTENT" "description:"
    assert_contains "Command $cmd: has allowed-tools" "$CMD_CONTENT" "allowed-tools:"
done

# --- Skill files exist ---
for skill in code-review refactor release sync-docs; do
    assert_file_exists "Skill: $skill/SKILL.md" ".claude/skills/$skill/SKILL.md"
done

# --- Agent files exist ---
for agent in code-reviewer security-auditor; do
    assert_file_exists "Agent: $agent.yml" ".claude/agents/$agent.yml"
done

# --- CLAUDE.md content sections ---
SECTIONS=("Overview" "Tech Stack" "Project Structure" "Conventions" "Key Commands" "Auto-Sync Rules")
for section in "${SECTIONS[@]}"; do
    grep -qF "## $section" CLAUDE.md && pass "CLAUDE.md: has $section" || fail "CLAUDE.md: has $section" "not found"
done

# --- Project-specific invariants ---
ROOT_CLAUDE=$(cat CLAUDE.md)
assert_contains "CLAUDE.md: mentions hub cluster name" "$ROOT_CLAUDE" "mall-apne2-mgmt"
assert_contains "CLAUDE.md: mentions Terraform 1.9.8 pin" "$ROOT_CLAUDE" "Terraform 1.9.8"
assert_contains "CLAUDE.md: mentions CF-only ingress rule" "$ROOT_CLAUDE" "CloudFront"

ARCH=$(cat docs/architecture.md)
assert_contains "architecture.md: has English section" "$ARCH" "<a id=\"english\">"
assert_contains "architecture.md: has Korean section" "$ARCH" "<a id=\"korean\">"

# --- gitignore covers .env ---
GITIGNORE=$(cat .gitignore)
assert_contains ".gitignore: .env is ignored" "$GITIGNORE" ".env"

# --- commit-msg hook installed ---
assert_file_exists "git commit-msg hook installed" ".git/hooks/commit-msg"
assert_file_executable "git commit-msg hook executable" ".git/hooks/commit-msg"
