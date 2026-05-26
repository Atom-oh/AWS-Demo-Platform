---
description: Execute the full validation suite (harness tests + terraform validate + kustomize build)
allowed-tools: Read, Bash(bash tests/run-all.sh:*), Bash(terraform fmt:*), Bash(terraform validate:*), Bash(kubectl kustomize:*), Glob
---

# Test All

Run the full validation suite for AWS Demo Platform.

## Step 1: Harness Tests

```bash
bash tests/run-all.sh
```

Validates: hook scripts, secret-scan patterns, structure invariants, CLAUDE.md content.

## Step 2: Terraform Validation (all modules)

For each directory under `infra/` containing `*.tf` files:

```bash
cd infra/<module>
terraform fmt -check -recursive
terraform validate
```

Note: `terraform init` must have been run at least once per module (state-backed). For CI, use `terraform init -backend=false`.

## Step 3: Kustomize Build (all k8s/system overlays)

```bash
for d in k8s/system/*/; do
  echo "=== $d ==="
  kubectl kustomize "$d" >/dev/null
done
```

Failure here means a manifest is malformed or missing.

## Step 4: ArgoCD Application Manifest Validation

```bash
for f in argocd-apps/**/*.yaml; do
  kubectl apply --dry-run=client -f "$f"
done
```

## Step 5: Report

Present:
- Total tests run, passed, failed, skipped
- Failed test details with file paths and error messages
- Suggest fixes for failing checks if the cause is apparent

## Error Recovery

| Failure Pattern | Likely Cause | Fix |
|---|---|---|
| "Backend configuration changed" | Cross-repo backend conflict | Run `terraform init -reconfigure` in the affected module |
| "Invalid configuration" (terraform) | HCL syntax error | Check the line reported by `terraform validate` |
| "kustomize build failed" | Missing base or bad patch | Run `kubectl kustomize <path>` in isolation to see full error |
| "Resource not found" (ArgoCD apply) | CRD not installed on target cluster | Verify ArgoCD/ESO CRDs exist before dry-run |
| "bash syntax error" | Bad edit in script | `bash -n <file>` to locate the error |

### If many tests fail at once
Likely a structural change broke multiple assumptions:
1. `git log -1` — what was the last change?
2. `git diff HEAD~1` — what specifically changed?
3. Fix the root cause, not individual tests
