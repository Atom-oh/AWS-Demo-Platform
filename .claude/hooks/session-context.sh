#!/bin/bash
# Load project context at Claude Code session start.

echo "=== Project Context ==="
echo "Project: AWS Demo Platform (Terraform + K8s/ArgoCD + future Next.js dashboard)"

LAST_COMMIT=$(git log -1 --format="%h %s (%cr)" 2>/dev/null)
[ -n "$LAST_COMMIT" ] && echo "Last commit: $LAST_COMMIT"

BRANCH=$(git branch --show-current 2>/dev/null)
[ -n "$BRANCH" ] && echo "Branch: $BRANCH"

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
[ -n "$LAST_TAG" ] && echo "Latest tag: $LAST_TAG"

CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "$CHANGES" -gt 0 ] && echo "Uncommitted changes: $CHANGES file(s)"

CLAUDE_COUNT=$(find . -name "CLAUDE.md" -not -path "./.git/*" 2>/dev/null | wc -l | tr -d ' ')
echo "CLAUDE.md files: $CLAUDE_COUNT"

# kube context warning
KUBE_CTX=$(kubectl config current-context 2>/dev/null)
if [ -n "$KUBE_CTX" ]; then
    echo "kube context: $KUBE_CTX"
    case "$KUBE_CTX" in
        *mall-apne2-mgmt*) ;;  # hub (full ARN or short alias)
        *) echo "  WARN: context is not the hub (expected *mall-apne2-mgmt). Verify before cluster-scoped ops." ;;
    esac
fi

echo "======================"
