---
name: refactor
description: Refactor existing project code or infrastructure while preserving behavior and resource ownership.
---

# Refactor Skill

Refactor existing code to improve quality without changing behavior. Applies to Terraform modules, Kustomize overlays, ArgoCD Application manifests, and the implemented dashboard TypeScript code.

## Principles
- Improve structure without changing infrastructure state (Terraform plan should show zero diff after refactor)
- Single Responsibility Principle per Terraform module / per K8s manifest
- Remove duplicate code (DRY) — common patterns become shared `infra/modules/` modules or Kustomize bases
- Small, incremental steps; verify with `terraform plan` and `kubectl kustomize` between each

## Process

### 1. Analysis
- Identify the target (module, manifest, value)
- Map all callers (other Terraform modules importing it, ArgoCD Applications referencing it)
- Confirm `terraform plan` is clean before refactor (no drift)
- For K8s: capture current rendered output via `kubectl kustomize <path>`

### 2. Plan
Present the refactoring plan to the user:
- What will change (file structure, module extraction, variable rename)
- Expected plan and rendered-manifest equivalence, distinguishing formatting from semantic changes
- Risk assessment (low/medium/high) — moving Terraform resources between state files is high

### 3. Execute
- Make changes in small, verifiable steps
- After each Terraform change: `terraform fmt && terraform validate && terraform plan`
- After each Kustomize change: `kubectl kustomize <path> | diff - <captured-baseline>`
- Prefer reviewed `moved` blocks within an owning state; any cross-state move needs an explicit ownership/cutover plan
- Keep commits atomic (one logical change per commit)

### 4. Verify
- `terraform plan` shows zero diff (or only the intended change)
- `kubectl kustomize` output unchanged (or only the intended change)
- ArgoCD shows Synced after sync
- Existing runbooks still apply
