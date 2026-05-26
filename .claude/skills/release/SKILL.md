# Release Skill

Automate the release process for AWS Demo Platform.

## Procedure

### 1. Pre-release Checks
- Verify working tree is clean: `git status`
- Verify ArgoCD has no `OutOfSync` Applications on hub
- Verify Atlantis has no pending plans
- Run harness tests: `bash tests/run-all.sh`

### 2. Determine Version
- Review changes since last tag: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Apply semver rules:
  - MAJOR: Breaking changes (e.g., cross-account role contract change, accounts.yaml schema change)
  - MINOR: New features, backward compatible (new infra module, new project onboarded)
  - PATCH: Bug fixes only (hotfix manifests, IAM policy tweaks)

### 3. Update CHANGELOG.md
- Move entries from `[Unreleased]` to a new version section
- Categorize: Added / Changed / Deprecated / Removed / Fixed / Security
- Include both English and Korean sections (per template)
- Update reference links at bottom of each section

### 4. Create Release
- Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z — <one-line summary>"`
- Push tag: `git push origin vX.Y.Z`
- ArgoCD picks up changes via `targetRevision: main` (no per-tag deploy)

### 5. Summary
- Display version bump
- List key changes from the new section
- Show next steps (push tag, write retrospective if a Stage milestone)
