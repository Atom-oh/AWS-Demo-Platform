#!/bin/bash
# Project setup script for new developers.
# Usage: bash scripts/setup.sh

set -e

echo "=== AWS Demo Platform Setup ==="

# Check prerequisites
command -v git >/dev/null 2>&1 || { echo "ERROR: git is required"; exit 1; }
command -v terraform >/dev/null 2>&1 || echo "WARN: terraform not found in PATH (need 1.9.8)"
command -v kubectl >/dev/null 2>&1 || echo "WARN: kubectl not found in PATH"
command -v argocd >/dev/null 2>&1 || echo "WARN: argocd CLI not found in PATH"
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI is required"; exit 1; }

# Verify terraform version (must be 1.9.x, NOT 1.10+)
if command -v terraform >/dev/null 2>&1; then
    TF_VER=$(terraform version -json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin)['terraform_version'])" 2>/dev/null || echo "unknown")
    echo "terraform version: $TF_VER"
    case "$TF_VER" in
        1.9.*) ;;
        unknown) ;;
        *) echo "WARN: terraform version is $TF_VER; this project pins to 1.9.x (backend uses dynamodb_table not use_lockfile)" ;;
    esac
fi

# Setup environment file
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "IMPORTANT: Edit .env with your actual AWS profile and region"
fi

# Setup Claude hooks
if [ -d ".claude/hooks" ]; then
    chmod +x .claude/hooks/*.sh
    echo "Claude hooks configured"
fi

# Install git commit-msg hook
if [ -d ".git" ] && [ -f "scripts/install-hooks.sh" ]; then
    bash scripts/install-hooks.sh
fi

echo "=== Setup Complete ==="
echo "Next steps:"
echo "  1. Edit .env with your AWS profile/region"
echo "  2. Read CLAUDE.md for project conventions"
echo "  3. Read docs/onboarding.md for development workflow"
echo "  4. For Terraform work: cd infra/<module> && terraform init"
echo "  5. For ArgoCD CLI access: argocd login argocd.atomai.click"
