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

Initialize each root with `terraform init -backend=false` for offline validation.
A real plan additionally needs the correct backend, identity and state; init is
not live validation.

## Step 3: Render Kubernetes manifests

Run `kubectl kustomize <dir>` for affected directories containing a
`kustomization.yaml`. Not every `k8s/system/*` directory is a standalone root;
render the owning overlay. Validate Helm values through their owning chart.

## Step 4: Dry-run changed ArgoCD resources

Resolve the intended cluster/account and pass `kubectl --context <context>`.
Run suitable client/server dry-runs on changed manifests after required CRDs and
other prerequisites exist. Missing prerequisites are a validation limitation,
not automatically malformed YAML. Bash `**` is not recursive without `globstar`.

## Application checks

- From `dashboard/backend`: `pnpm -r build`, `pnpm -r lint`, `pnpm -r test`.
  Integration tests need LocalStack on port 4566.
- From `dashboard/frontend`: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
  Vitest does not replace TypeScript compilation.

## Step 5: Report

Present:
- Total tests run, passed, failed, skipped
- Failed test details with file paths and error messages
- Suggest fixes for failing checks if the cause is apparent

## Error Recovery

| Failure Pattern | Likely Cause | Fix |
|---|---|---|
| "Backend configuration changed" | Backend arguments differ | Verify owner/bucket/key first; reconfigure only the intended state |
| "Invalid configuration" (terraform) | HCL syntax error | Check the line reported by `terraform validate` |
| "kustomize build failed" | Missing base or bad patch | Run `kubectl kustomize <path>` in isolation to see full error |
| "Resource not found" (ArgoCD apply) | CRD not installed on target cluster | Verify ArgoCD/ESO CRDs exist before dry-run |
| "bash syntax error" | Bad edit in script | `bash -n <file>` to locate the error |

### If many tests fail at once
Likely a structural change broke multiple assumptions:
1. `git log -1` — what was the last change?
2. `git diff HEAD~1` — what specifically changed?
3. Fix the root cause, not individual tests
